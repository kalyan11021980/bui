# `sample/` — test assets

Fixtures that outlive any one experiment. Nothing here is generated at test time;
if a file changes, a recorded result stops being comparable to the ones before it.

```
sample/
  licenses/
    specimens/    real published specimen cards + hand-transcribed ground truth
    synthetic/    rendered cards with pixel-exact boxes + a point-size ladder
```

## `licenses/specimens/`

Official **sample** cards published by state DMVs and mirrored on Wikimedia
Commons. They carry printed placeholder identities (`SAMPLE, JANE`,
`CARDHOLDER, IMA`) and are not any real person's document. See `SOURCES.md` for
per-file origin and licence.

Ground truth is in `ground_truth.json`, keyed by our own `FieldId`s, so a score
reads directly as *could OCR fill this required field* rather than as an
abstract character-accuracy number.

**No real person's licence belongs in this folder**, whatever its provenance.
The specimens are here precisely so nobody needs one.

## `licenses/synthetic/`

Rendered by `tools/ocr-gate/render_cards.py`. Two kinds:

- `card_{600,300,150}.png` — the same card at the same *physical* size (ID-1,
  3.375in × 2.125in) at three pixel densities. Because the physical size is
  fixed, every point size on the card corresponds to real printed type, and the
  three files isolate one variable: how much resolution survives to the model.
- `ladder_600.png` — one non-guessable alphanumeric string per point size from
  12pt down to 5pt. Finds the size at which reading collapses. The strings are
  deliberately random (`W5L192-8374`) so a model must *read* them; a plausible
  date or name could be inferred from context and would flatter the result.

`ground_truth.json` here carries **pixel-exact** boxes on a 0–1000 scale, taken
from the renderer's own text metrics — unlike the specimen boxes, these are
sound enough for real IoU.

## What these assets cannot tell you

Every image here is flat, evenly lit and squarely framed. Together they measure
resolution and layout robustness, and nothing else. Glare on a laminate,
holographic interference, skew, shadow and motion blur are absent, and those are
ordinary in phone captures. A pass on this folder is a **necessary, not
sufficient** condition — see the OCR acceptance gate in the design spec.
