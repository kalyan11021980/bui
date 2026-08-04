# Phase 2 closeout — what shipped, and what is still open

**Date:** 2026-08-03
**Branch:** `phase-2-ocr-provenance`, 60 commits
**Design:** `2026-08-02-phase-2-ocr-provenance-design.md` · **Plan:** `2026-08-02-phase-2-ocr-provenance.md`

## What works

An applicant photographs an identity document and the fields it can answer arrive
pre-filled, each showing a crop of the region the value was read from and a confidence
derived from evidence we can observe. Verified in a browser against the real model, not
only in tests:

- **Driver's licence** (`wa_enhanced`): 9 fields. `dl_number` at 0.69, correctly noisy
  because the value carries glyph-confusable characters; the rest at 0.89.
- **Passport** (`nl_passport_2014`): 5 fields. The sixth, `passport_number`, is
  **suppressed** — OCR read the printed `SPECI2014` as `SPEC12014` and the MRZ check
  digit rejected it. That suppression is the clearest evidence the design's premise
  holds.
- **Dealer licence**: 4 fields over the API and now reachable from the UI.

741 tests, no test requiring an OCR server.

## Numbers worth keeping

| Measure | Value |
|---|---|
| Fit model | `stretch`, IoU 0.856 against 0.491 for `pad`; control exact at delta 0.000000 |
| Corpus quiet rate | 52% of extracted fields, with 0 of 5 known-wrong values quiet |
| AAMVA recall | 60 of 66 read correct, graded on the string the applicant actually sees |
| Labelled recall | 4 of the 9 fields a dealer licence prints |
| Proof of residency | 0 fields, by catalog decision, pinned by test |

## Open, and why each is open

**1. Axis B of the OCR acceptance gate — unrun. Gates production enablement.**
Every image in the corpus is a flat scan. Glare, skew, low light, defocus and motion blur
are untested, and they are ordinary in phone captures. This decides whether the production
OCR target stays LM Studio or moves to an `mlx-vlm` sidecar, and `QUIET_THRESHOLD` should
be expected to need retuning against non-flat captures. Needs 8–10 captures of one
physical card: flat light as control, then deliberate laminate glare, low light, ~20°
skew, slight defocus. One card throughout, so a single transcription covers the set and
capture condition is the only variable.

**2. Compliance sign-off — outstanding, and now load-bearing.**
`STATE_RULES` for GA and OH are `signedOff: false`, and tax-id-is-business-only was never
ruled on. `signedOff` has **no runtime reader**, so Ohio's additional form is enforced
against applicants today on a rule nobody has signed. Encoding licensing rules is not a
developer's call.

**3. EXIF orientation — handled, thinly verified.**
A canvas re-encode makes the uploaded bytes and the measured pixels share an orientation.
Verified in one browser run against one rotated JPEG carrying Orientation 6. No genuine
phone capture has been tested; the Axis B set would close this at the same time.

**4. `type: 'file'` schemas are unbounded.**
Nothing caps what a file field's value may contain, so a large enough value could put
image-sized data in the append-only audit log. No path does this today — the document
pipeline never writes bytes to the record — but the schema does not prevent it.

**5. No client-side downscale.**
A modern phone photo is uploaded at full resolution. The payload cap refuses the extreme
case; nothing reduces the ordinary one.

**6. The per-session document-image map is uncapped.**
The browser holds one data URL per uploaded document so crops can be drawn. The profile
asks for at most three documents, so it is bounded in practice, not by construction.

## What the phase learned about its own verification

Three distinct ways a test suite can be green and prove nothing, each found the hard way:

1. **A mutation that silently fails to apply.** A pattern substitution that never matched
   left the code untouched, the suite green, and the result indistinguishable from a test
   that cannot fail. It errs in the direction that flatters the work.
2. **A failure that is only the runner's unhandled-error report.** The run goes red while
   every assertion still passes. It scores as caught and asserts nothing.
3. **A throw that pre-empts the assertions.** The test fails for a real reason before any
   `expect()` executes.

And the structural version: **tests that pin presence rather than effect.** Pipeline
wiring was silently droppable three separate times — strategy registration imports, a
store Next bundled per-route, and a re-spacer's composition order — because each test
asserted that a value looked right rather than that the signal behind it was computed.
Ten of fifteen task briefs shipped at least one test that could not fail. Every one was
caught by a person, never by the suite.
