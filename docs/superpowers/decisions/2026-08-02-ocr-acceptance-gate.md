# OCR acceptance gate — Axis A result

**Date:** 2026-08-02
**Model:** DeepSeek-OCR via LM Studio (host from `OCR_ENDPOINT`, model from `OCR_MODEL`)
**Harness:** `tools/ocr-gate/` · **Assets:** `sample/licenses/` · raw results committed alongside

## The question the spec asked

> Run DeepSeek-OCR against real driver's license photographs at production capture
> resolution and measure field accuracy and box correctness. LM Studio resizes vision
> inputs to 500px wide, which degrades small print and shifts grounding coordinates;
> small print *is* a license number. **If accuracy or box fidelity fails at 500px, the
> production target becomes an `mlx-vlm` sidecar and LM Studio is development-only.**

## Verdict

**The 500px premise does not hold, and recognition is not the constraint.** Nothing in
this result forces the `mlx-vlm` sidecar. **Localisation, not recognition, is the weak
axis**, and the gate is only half answered — see *What this does not license* below.

## What was measured

Two asset families, deliberately different in what they can prove.

**Synthetic cards** (`sample/licenses/synthetic/`) — the same card rendered at a fixed
*physical* size (ID-1, 3.375in × 2.125in) across seven pixel densities. Because physical
size is pinned, every point size on the card corresponds to real printed type, and the
sweep isolates one variable. Boxes are pixel-exact from the renderer's own text metrics.

**Specimens** (`sample/licenses/specimens/`) — four official DMV sample cards (WA, MA, DC,
CA) with real card layout, guilloche backgrounds and security overprint. Ground truth is
hand-transcribed against our own `FieldId`s, so a score reads as *could OCR fill this
required field*, not as an abstract accuracy number.

Metrics follow standard practice: **field-level exact match** as the primary measure (one
wrong character fails the field), CER secondary, and **IoU ≥ 0.5** for detection, per the
ICDAR/COCO convention.

## Result 1 — recognition is resolution-insensitive far below the worry line

Grounded mode, synthetic card, field-level exact match:

| Card width | ≈dpi at card size | Fields read | IoU ≥ 0.5 |
|---|---|---|---|
| 2025px | 600 | **12/12** | 8/12 |
| 1012px | 300 | **12/12** | 8/12 |
| 506px | 150 | **12/12** | 7/12 |
| 405px | 120 | **12/12** | 3/12 |
| 338px | 100 | **12/12** | 3/12 |
| 270px | 80 | 10/12 | 4/10 |
| 202px | 60 | 7/12 | 4/7 |

Reading is perfect down to a **338px-wide card** — a third of the resolution the spec was
worried about. The point-size ladder is more direct still: at 600dpi the model read
non-guessable alphanumeric strings correctly at **every size from 12pt down to 5pt**,
including `P4V027-9186` at 5pt. Licence-number print is 9–10.5pt. There is substantial
headroom.

The 2025px, 1012px and 506px runs return near-identical output (539–540 completion tokens,
IoU within noise). That is the signature of the server normalising all three to one
internal size, which corroborates the spec's mechanism — DeepSeek-OCR grounding
coordinates are normalised within a 1024×1024 input, not 500px. But the *consequence* the
spec feared does not follow: whatever the target size is, small print survives it.

**Fields die in size order, as expected** — at 270px the 7pt city/state/zip line and the
6.5pt height go first; at 202px the 7.5pt date row collapses. The failure mode is orderly
and predictable, not erratic.

## Result 2 — localisation degrades long before recognition does

This is the finding that matters, and it inverts the spec's expectation.

At 405px the model still reads **12/12 fields perfectly** but places only **3/12** boxes
within IoU 0.5. Recognition holds while grounding falls apart. Anything that consumes box
coordinates — the inline provenance crops Phase 2 is built around — is therefore gated on
a **higher** input resolution than the text extraction is.

Three concrete localisation behaviours, all reproducible:

1. **Boxes merge label into value.** WA returns `4dLIC#WDLJK00580GF` as one detection
   spanning both. A crop from that box includes the label. For a provenance crop that is
   arguably desirable, but it must be a decision, not a surprise.
2. **Duplicated values return multiple boxes.** The WA licence number is printed twice —
   `4d LIC#` at top, `5 DD` at bottom — and grounding returns both. Selecting a box by
   value alone crops the wrong region; my harness picked the bottom one and scored 0.0
   where the top occurrence scores 0.664. **Disambiguation must use the label, not the
   value.**
3. **Small fields get loose boxes.** At 6.5pt, IoU sits around 0.37–0.45 even when the
   text is read perfectly.

## Result 3 — specimens, and the two real failures

Grounded mode, field-level exact match against our required fields:

| Card | Source px | Fields read | `dl_number` IoU |
|---|---|---|---|
| WA enhanced | 1560 | **9/9** | 0.664 * |
| MA 2016 | 795 | **9/9** | 0.334 |
| DC 2018 | 696 | **9/9** | 0.754 |
| CA 2019 | 602 | 7/9 | — misread |

\* against the `4d LIC#` occurrence; see duplicate-value note above.

**34/36 = 94.4% field-level exact match.** Both failures are on the CA card, the
lowest-resolution specimen (~178dpi at card size), and both are consequential:

- **`I1234568` was read as `11234568`** — a capital I taken for a digit 1, in the licence
  number. The same confusion appears benignly elsewhere (`120 lb` → `120 Ib`), so it is a
  systematic glyph-shape ambiguity, not a one-off. **Alphanumeric ID fields are exactly
  where this class of error lands, and it produces a plausible-looking wrong value** — the
  worst kind, because nothing downstream flags it.
- **The ZIP `95818` was lost entirely**, returned as `ANYTOWN,CAPO`.

For context, the 2026 bar for straight-through processing of identity documents is ~99.9%
field-level accuracy. 94.4% on clean, flat, well-lit specimens is nowhere near it — and it
does not need to be, because the design already requires the applicant to confirm address, legal
name and taxpayer ID individually, and requires every carried value to show provenance.
**This result is an argument for keeping those rules, not for relaxing them once OCR
arrives.**

## Operational findings

- **Default to `<|grounding|>`, but it does not dominate.** Grounded wins on aggregate,
  34/36 against 31/36, and by a wide margin on two cards (MA 9/9 vs 7/9, DC 9/9 vs 7/9).
  **It loses on CA, 7/9 against 8/9** — plain mode recovered the ZIP that grounded dropped.
  Plain has its own blind spot: it omitted `4a ISS 07/02/2025` from the synthetic card
  entirely. Neither mode is a superset of the other, so for maximum field recall Phase 2
  should consider running both and merging, at ~1s and ~4× completion tokens for the
  grounded pass. Only grounded returns boxes, so it is mandatory wherever crops are needed.
- **Do not send `<image>` in the prompt text.** LM Studio inserts one image token per
  attachment; a second makes the counts disagree and the server returns HTTP 400.
- **Latency is not a concern**: 0.8–1.7s per card at any resolution tested.

## What this does not license

Every image in this gate is **flat, evenly lit and squarely framed**. Glare on a laminate,
holographic interference, skew, shadow and motion blur are absent, and they are ordinary in
phone captures. The WA and MA specimens carry heavy security overprint, which is the
closest thing here to real interference and which both survived — encouraging, not
conclusive.

So this is Axis A only, and Axis A is a **necessary, not sufficient** condition. **The
gate is not yet closed.** What remains:

1. **Axis B.** 8–10 phone captures of one physical card: flat/even light as control, then
   deliberate laminate glare, low light, ~20° skew, slight defocus. One card throughout, so
   a single transcription covers the set and capture condition is the only variable.
2. **A minimum-resolution floor for the upload control**, derived from the localisation
   curve rather than the recognition curve — provisionally ≥1000px card width, since IoU
   ≥ 0.5 holds at 1012px and collapses by 405px.
3. **A label-anchored box-selection rule**, given the duplicate-value behaviour above.

## Recommendation

Proceed with LM Studio as the Phase 2 development target and **do not commit to the
`mlx-vlm` sidecar on resolution grounds** — the evidence does not support it. Leave the
production-target decision open until Axis B runs, since real capture conditions are now
the only place the risk lives.

Treat `carried` provenance as **confidence-bearing and always applicant-confirmed**. The
`I`→`1` failure is precisely the case that a "looks right, tick it" flow would wave
through, and it is the case the no-bulk-confirmation rule exists to catch.
