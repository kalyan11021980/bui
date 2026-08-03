# Phase 2 — OCR and provenance

**Date:** 2026-08-02
**Depends on:** Phase 1 (complete, merged at 318c4ca) and the OCR acceptance gate,
Axis A (`docs/superpowers/decisions/2026-08-02-ocr-acceptance-gate.md`)

## 1. What this phase delivers

An applicant photographs a document; fields the document can answer arrive pre-filled,
each showing where it came from and inviting a check. Everything the document cannot
answer is asked for exactly as it is today.

This is where the effort reduction the project exists for actually arrives. Phase 1 built
a form that knows what it needs; Phase 2 stops asking for what is already printed on
something in the applicant's wallet.

**What it does not deliver.** No agent, no conversation, no review queue, no signing. The
panel remains the whole interface.

## 2. What the gate already settled

Three findings from Axis A are load-bearing here, and the design is shaped around them.

**Recognition is not the constraint.** Fields read perfectly down to a 338px card width,
and the model read non-guessable alphanumerics at every point size from 12pt down to 5pt.
Licence-number print is 9–10.5pt. There is substantial headroom, and no reason to reach
for an `mlx-vlm` sidecar on resolution grounds.

**Localisation is.** At 405px the model reads 12/12 fields correctly and places 3/12 boxes
within IoU 0.5. Recognition holds while grounding falls apart. Anything consuming box
coordinates is gated on a higher resolution than text extraction is — and this design
takes that literally by separating the two into different quality bands.

**Plausible wrong values are the real risk.** The CA specimen returned `11234568` for
`I1234568` — a capital I read as a digit 1, inside a licence number. Nothing downstream
would flag it. This single failure justifies most of what follows: the confidence model,
the per-field confirmation rule, and the checksum preference for passports.

## 3. Scope

Five document types, three extraction problems.

| Family | `DocType` | Structure available | Fields unlocked |
|---|---|---|---|
| AAMVA card | `drivers_license`, `state_id` | Printed field codes (`4d LIC#`, `3 DOB`, `4b EXP`) | 7 identity fields and 4 address fields |
| Machine-readable zone | `passport` | Fixed 44-character lines, **check digits** | 5 identity fields, self-verifying |
| Labelled document | `dealer_license`, `proof_of_residency` | Labels only, no layout | 9 licence and business fields; residency address |

The third family is the weak one and is marked as a seam throughout. If its measured
recall is poor it can be cut into a Phase 2b without disturbing the other two.

### 3.1 The passport is the strongest document here, not the exotic one

A TD3 machine-readable zone carries check digits over the passport number, date of birth,
expiry and a composite of all three. That makes it the only document in the set that can
verify its own reading. The `I`→`1` substitution class that produced the CA failure fails
a checksum instead of passing silently. Where a card gives us a plausible value, a
passport gives us a value we can prove was read correctly.

## 4. Architecture

One pipeline, six stages, each independently testable.

```
File chosen (client)
  │
  ├─ 1. Pre-flight        pixel width → quality band → accept / accept-without-crops / re-take
  │
  ├─ 2. Transport         POST to the app's own route; image held for the request, never persisted
  │
  ├─ 3. OcrService.read   → { text, detections, imageSize }
  │
  ├─ 4. Extraction        strategy chosen by DocType → candidates { key, value, box?, evidence }
  │
  ├─ 5. Confidence        evidence → score
  │
  └─ 6. Dispatch          SET_VALUE(source: 'ocr') per candidate → panel renders derived rows
```

Stages 4 and 5 are pure functions in `src/domain/`. Stage 3 is the only one that touches
the network. Stage 1 is the only one that needs the browser. This split is what lets the
whole suite run with LM Studio switched off.

### 4.1 Module layout

Following the existing structure — domain logic pure, server logic thin.

```
src/domain/ocr/
  grounding.ts          exists: parse, IoU, findValue
  geometry.ts           new: normalised model space → original-image pixels
  quality.ts            new: pixel width → quality band
  confidence.ts         new: evidence → score
  extract/
    index.ts            new: DocType → strategy, and the Candidate type
    aamva.ts            new: label-anchored card extraction
    mrz.ts              new: TD3 fixed-offset parse and check digits
    labelled.ts         new: synonym-table extraction for unstructured documents
    synonyms.ts         new: the label tables, data not code

src/server/ocr/
  client.ts             exists: HTTP transport
  service.ts            new: OcrService — read, and the fixture-backed provider seam

src/ui/panel/
  Provenance.tsx        extend: confidence and crop
  DocumentCrop.tsx      new: clip the client-held original to a box
  DocumentUpload.tsx    new: file input, pre-flight, quality copy
```

### 4.2 On the service shape

The original design sketched `OcrService` returning `{ fields, boxes?, confidence,
imageSize }` — one call from image to fields. This design splits reading from
interpreting: `read` returns text, detections and image size; extraction is a separate
pure function.

The reason is testability. Reading needs a server; interpreting needs only a recorded
response. Fusing them would make every extraction test require LM Studio, which the
testing rules forbid. The composed result still has the sketched shape at the service
boundary, so nothing downstream notices.

## 5. Quality bands

The gate found recognition and localisation failing at different resolutions, so one
threshold cannot serve both. Three bands, measured on the image's pixel width:

| Band | Width | Behaviour |
|---|---|---|
| **Full** | ≥ 1000px | Extract and show crops. IoU ≥ 0.5 holds at 1012px. |
| **Text-only** | 400–999px | Extract normally, **suppress all crops**, provenance degrades to text plus confidence. |
| **Re-take** | < 400px | Ask for another photo before calling OCR at all. |

The middle band is the point. Between 400 and 1000px we can read the card correctly but
cannot place a box on it, and a crop drawn from a bad box is an assertion that a value came
from a region it did not. A wrong crop is worse than no crop; the degraded mode is already
a supported path, so falling back to it costs nothing.

### 5.1 Pixel width is a proxy, and it is checked twice

The bands are stated in *card* width, but an upload is an image that may contain a card
plus a kitchen table. Two checks:

- **Before the call**, image pixel width stands in for card width, with capture copy
  asking the applicant to fill the frame. Cheap, and it catches the genuinely unusable.
- **After the call**, the union of all returned detections estimates the card's actual
  extent. If the card occupied a small fraction of the frame, the result is demoted to
  the text-only band and crops are suppressed even though the image was large.

The second check is what makes the first honest.

## 6. Extraction

Deterministic, per-family strategies. No model is involved in turning text into fields.

The argument for determinism is that a miss is cheap. The design already establishes that
an OCR miss is not an error — the applicant is asked as they would have been anyway, and
there is no failure state. So a weak extractor costs less reduction and nothing else,
while a non-deterministic one puts values into a KYC record with no reproducible
derivation. That trade is one-sided.

Each strategy returns candidates; it never writes state.

```ts
type Candidate = {
  key: RequirementKey
  raw: string                    // as read, before schema parsing
  box?: Box                      // normalised model space; mapped later
  evidence: Evidence             // what we know about how it was obtained
}
```

### 6.1 AAMVA cards

Field codes are printed on the card and are the anchor. `findValue` already implements
label-anchored selection, which exists because the Washington card prints its licence
number twice and value-alone selection picks the wrong occurrence about half the time.

| Field | Anchors |
|---|---|
| `dl_number` | `4d`, `LIC#`, `DLN`, `LIC NO`, `DL NO` |
| `dob` | `3`, `DOB` |
| `dl_expiry` | `4b`, `EXP` |
| `last_name` | `1`, `LN` |
| `first_name` | `2`, `FN` |
| `addr_line1`, `addr_city`, `addr_state`, `addr_zip` | `8` |
| `id_state` | issuing authority text |

Two behaviours from the gate are handled explicitly. Cards merge label into value, so
`4dLIC#WDLJK00580GF` arrives as one detection and the label prefix is stripped after
anchoring. Address arrives as a multi-line block under a single code and is split by line
before being mapped to the four address fields. `addr_line2` is deliberately not
extracted — apartment and unit lines are the least reliably printed and the most reliably
wrong, and the catalog already declines to declare it derivable.

**One catalog reconciliation.** The four address fields declare `derivableFrom:
['drivers_license']` but not `'state_id'`, while the seven identity fields declare both. A
state ID prints an address exactly as a licence does, so this looks like an omission
rather than a decision. The plan confirms it against the specimen set and, if it is an
omission, corrects the catalog — the extractor must not derive a field the catalog says is
not derivable from that document.

### 6.2 Passports

Locate the two 44-character lines, parse by fixed offset, validate every check digit.
**A field whose check digit fails is not emitted at all.** We would rather ask than record
a value we can prove is misread — this is the CA failure caught by arithmetic instead of
by an applicant who was not looking closely.

### 6.3 Labelled documents

A synonym table per field (`License No.`, `Licence Number`, `Lic #`) and value patterns
for dates and money. Expected recall is the lowest of the three and the plan measures it
rather than assuming it. If it comes out poor, this strategy is the piece that gets cut or
swapped for a local structuring model behind the same interface — which is the entire
reason the strategies sit behind an interface.

## 7. Confidence

The interface rule is that confidence drives display: high-confidence extractions collapse
to a quiet row, low-confidence ones surface with the crop. **DeepSeek-OCR returns no
confidence score.** Grounded output is text and a box, nothing more.

Token logprobs were considered and rejected. The failure that matters — `I` read as `1` —
is a *high*-probability substitution, so a logprob-derived score would rate the single
worst failure mode as certain. It would be confident precisely where it should not be.

Instead, confidence is derived from evidence we can observe:

| Signal | What it tells us |
|---|---|
| Schema parse | The value satisfies the field's existing Zod schema. A date that is not a date is not a low-confidence date. |
| Label anchored | The detection carried the expected field code, not just a matching substring. |
| Checksum | MRZ check digit validated. The strongest signal available and near-decisive. |
| Cross-pass agreement | Grounded and plain passes returned the same value. |
| Box plausibility | The box sits inside the estimated card extent and has sane proportions. |
| Glyph ambiguity | An identifier contains mutually confusable characters — `0 O 1 I 5 S 8 B`. Subtracts only; it never earns a value credit. |

The glyph signal was added after the AAMVA extractor shipped `11234568` for a card printing
`I1234568` with every other signal green. No other signal can see that failure: the value
is well-formed, correctly located and label-anchored, and only its shape betrays it. A
checksum outranks it — an MRZ number proves itself arithmetically, so glyph shape stops
mattering there.

Cross-pass agreement is worth its cost. The gate found neither mode dominates: grounded
won overall, 34/36 against 31/36, but **lost on the CA card, 7/9 against 8/9** — plain
recovered a ZIP that grounded dropped. Two passes cost about a second and roughly four
times the completion tokens for the grounded one. In exchange, disagreement is a direct
signal of the exact failure class we most fear: on the CA card, the two passes disagreed
about the licence number.

Scoring is a pure function over these signals and is the phase's most sabotage-testable
unit. The specific weights belong in the implementation plan, tuned against the specimen
set; what this design fixes is that **no signal is the model's own opinion of itself.**

### 7.1 Confidence never removes a confirmation

High confidence makes a row quiet. It does not make it confirmed. Address, legal name and
taxpayer ID keep individual, deliberate confirmation regardless of score, and no bulk
confirmation exists at any confidence. The gate's recommendation is unchanged: the `I`→`1`
failure is exactly what a "looks right, tick it" flow waves through.

## 8. Documents and crops

**The server never persists an image.** It is posted for the OCR call, held for the
duration of the request, and discarded. The browser keeps its own copy and renders crops
by clipping the original with CSS — no image processing library, and no identity documents
at rest to encrypt, retain or expire.

The cost is that crops do not survive a reload: the box coordinates persist in
`FieldState.provenance`, the pixels do not. That lands in the already-supported degraded
mode — text attribution plus confidence, no layout change, no broken affordance.

Phase 4's reviewer will need durable documents, and that is the right phase to answer
retention, encryption and expiry in. Deciding it here would drag a compliance question
into a phase whose real risk is elsewhere.

### 8.1 Coordinate mapping is the sharpest technical risk

Grounding coordinates are normalised 0–1000 against the model's own square input. The gate
compared boxes in that normalised space and never mapped them back, so **the mapping to
original-image pixels is entirely new and unproven.**

The specific unknown: whether the server pads a non-square image to square before
inference. If it does, `x_px = x / 1000 * width` is wrong for every non-square upload —
and every photograph of a card is non-square. A crop off by a letterbox band is precisely
the confidently-wrong provenance this design refuses to ship.

This is settled empirically, not by assumption: render a card with markers at known
positions across several aspect ratios, map the returned boxes back, and compare against
truth. A property test then asserts round-tripping for any input size, as the testing
rules require.

## 9. Failure and degraded modes

| Situation | Behaviour |
|---|---|
| OCR endpoint unreachable | Manual entry, unchanged. Not an error state. |
| No fields extracted | The panel asks for everything, as it does today. |
| Some fields extracted | The rest are asked for. There is no partial-failure message. |
| Boxes absent or untrustworthy | Text provenance plus confidence. No layout change. |
| Checksum fails | Field not emitted. Asked for normally. |
| Value fails its schema | Field not emitted. A malformed read is not a low-confidence read. |
| Image below the floor | Re-take asked for before any call is made. |

The single rule underneath: **an unfilled field is the normal case, not a failure.** Every
degraded mode collapses to the Phase 1 experience, which is complete and works.

## 10. Testing

Extending the Phase 1 suite, which stands at 356 tests.

- **No test requires LM Studio.** Provider responses are recorded fixtures. The one
  gate-style test that does hit the server is opt-in and skipped by default.
- **Coordinate round-trip** — property test that boxes map back to original-image space
  for any input size and aspect ratio.
- **Per-strategy extraction** — each specimen's known values, asserted field by field.
- **Checksum rejection** — a corrupted MRZ character must suppress the field, not lower
  its score.
- **Confidence ordering** — sabotage tests: a value that fails its schema, or that the two
  passes disagree on, must score below one that passes both.
- **Band behaviour** — a 500px image extracts and shows no crop; a 300px image is never
  sent.
- **Degraded end-to-end** — the application completes with the OCR endpoint unreachable,
  and completes with boxes absent.
- **No new PII surface** — no document bytes reach the audit log or any persisted record.

## 11. Fixtures to source

The current set is four AAMVA cards. All five document types need coverage.

- More AAMVA specimens, for label and layout variety across states
- A specimen passport with a readable MRZ
- A dealer licence sample, the hardest to find; if none exists publicly, a synthetic
  stand-in is built and **labelled as such** rather than passed off as coverage
- Proof-of-residency samples: utility bill, bank statement

Sourcing rule, as with the existing four: official specimens printed with a placeholder
identity, never a real person's document, each recorded in `sample/licenses/SOURCES.md`
with provenance and licence — including where terms are CC BY-SA rather than public
domain, which already constrains derivative crops leaving the company.

Published specimens broaden layout coverage. They cannot close Axis B, which is about
capture conditions.

## 12. What remains open

**Axis B of the acceptance gate.** Every image tested so far is flat, evenly lit and
squarely framed. Glare, skew, low light and defocus are untested and ordinary in phone
captures. This needs 8–10 captures of one physical card: flat light as control, then
deliberate laminate glare, low light, ~20° skew, slight defocus. One card throughout, so a
single transcription covers the set and capture condition is the only variable.

It does not block this phase. It decides the **production** OCR target — LM Studio or an
`mlx-vlm` sidecar — which sits behind the provider seam and changes no other module. The
work is planned so Axis B can run alongside it.

**Compliance sign-off**, carried over: `STATE_RULES` for GA and OH are `signedOff: false`,
and tax-id-is-business-only was never ruled on. Not a developer's call, and not blocking
development.

**Labelled-document recall**, to be measured rather than assumed, with a Phase 2b split as
the response if it is poor.
