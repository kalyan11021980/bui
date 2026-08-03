# OCR fit model — how grounding coordinates map back to pixels

**Date:** 2026-08-02
**Model:** DeepSeek-OCR via LM Studio (host from `OCR_ENDPOINT`, model from `OCR_MODEL`)
**Harness:** `tools/ocr-gate/calibrate.test.ts` · **Assets:** `sample/licenses/calibration/`
**Raw results:** `sample/licenses/calibration/observed.json` (the boxes the model returned)

## The question

DeepSeek-OCR returns boxes normalised 0–1000 against **its own square input**. Uploaded ID
photographs are not square. To turn a returned box back into a crop of the applicant's
photo we have to know what the server did to make the image square:

- **`stretch`** — resized to a square, aspect ratio not preserved. Each axis scales
  independently.
- **`pad`** — letterboxed into a square of the longer side, image centred. The short axis
  carries a band that must be subtracted.

Both are plausible, both produce boxes that *look* reasonable, and they diverge by exactly
the letterbox band — a third of the image height on a 3:2 card photo. Guessing puts every
provenance crop off by that band while looking entirely credible. `toPixels` was written to
support both precisely so this could be measured rather than assumed.

## What was measured

Three calibration cards (`tools/ocr-gate/render_cards.py`), each carrying four long,
mutually dissimilar marker strings at known pixel positions — one near each edge:

| Marker | Position |
|---|---|
| `MARKERNORTH` | centred, 5% from the top |
| `MARKERSOUTH` | centred, 5% from the bottom |
| `MARKERWEST` | left-aligned, vertically centred |
| `MARKEREAST` | right-aligned, vertically centred |

The **vertical** pair is what decides it: a letterbox band moves `y` and leaves `x` alone.
Truth boxes are **true pixels**, taken from PIL's own text metrics — the mapping *into*
pixel space is the thing under test, so normalising the truth would have assumed the answer.

Rendered at 1:1 (1200×1200), 16:10 (1600×1000) and 3:4 (900×1200), all ≥1200px on the long
edge so resolution is never the confound. Scoring is IoU against the printed box, with
centre offset recorded alongside as a second opinion — IoU is sensitive to how tightly the
model draws a box around a word, centre offset is not.

**The 1:1 card is the control.** Both models are arithmetically identical on a square, so if
it scored badly the fault would be in the markers, the renderer or the parsing, and the
non-square numbers would mean nothing.

## Result

All **12/12 markers were read** on all three cards. Nothing here is a recognition failure,
so every number below is a pure localisation measurement.

Mean IoU over the four markers:

| Card | Size | `stretch` | `pad` |
|---|---|---|---|
| square (control) | 1200×1200 | 0.854 | 0.854 |
| landscape 16:10 | 1600×1000 | **0.864** | 0.300 |
| portrait 3:4 | 900×1200 | **0.847** | 0.682 |

The control agrees to six decimal places, as it must. The harness is sound.

Per-marker on the two non-square cards, where the whole question lives:

| Card | Marker | `stretch` IoU | `stretch` centre | `pad` IoU | `pad` centre |
|---|---|---|---|---|---|
| 16:10 | `MARKERNORTH` | 0.800 | 5px | **0.000** | 50px |
| 16:10 | `MARKERSOUTH` | 0.841 | 4px | **0.000** | 50px |
| 16:10 | `MARKERWEST` | 0.960 | 3px | 0.603 | 3px |
| 16:10 | `MARKEREAST` | 0.856 | 5px | 0.598 | 6px |
| 3:4 | `MARKERNORTH` | 0.850 | 2px | 0.655 | 2px |
| 3:4 | `MARKERSOUTH` | 0.854 | 2px | 0.651 | 2px |
| 3:4 | `MARKERWEST` | 0.839 | 1px | 0.712 | 33px |
| 3:4 | `MARKEREAST` | 0.847 | 2px | 0.712 | 32px |

## Verdict — `stretch`

**The server resizes to a square without preserving aspect ratio.** `FIT_MODEL = 'stretch'`
is pinned in `src/domain/ocr/geometry.ts`.

The margin is not marginal. Under `stretch` every one of the twelve markers lands within
**6px of its printed centre**, on images 900–1600px across — sub-1% error on both axes,
which is the signature of a mapping that is simply correct rather than one that happens to
score better. Under `pad` the two vertical markers on the 16:10 card are pushed clean off
the image and clamp to zero-height boxes at IoU 0.000: normalised `y` came back near 30 and
960, which is where text 5% from the edge sits only if the whole image height fills the
square.

The result also explains the shape of the residual `pad` scores. On the 16:10 card the
horizontal markers still score ~0.60 under `pad` because a letterbox on the short axis
leaves `x` alone and only stretches the box's height. On the 3:4 card `pad` looks less
catastrophic — mean 0.682, every marker above 0.5 — because a 900×1200 image pads on `x`,
so the vertical markers survive and only the horizontal pair drifts, by 32–33px. **A test
that only checked the portrait and square cards would pass under either model.** That is
why the pinned-mapping test in `tests/domain/ocr/geometry.test.ts` iterates every aspect
ratio, and it is confirmed to fail on the 16:10 card if `FIT_MODEL` is flipped to `'pad'`.

**Confidence: high.** Unambiguous separation, a clean control, a mechanism consistent with
the residuals, and no unread markers muddying the sample.

## What this does not license

- **It is one server, one configuration.** This measures LM Studio's vision preprocessing
  for `deepseek-ocr` as configured on 2026-08-02. A different host — the `mlx-vlm` sidecar
  left open by the acceptance gate — must be re-measured, not assumed. Rerun
  `pnpm vitest run tools/ocr-gate/calibrate.test.ts` against it and compare.
- **It says nothing about box quality.** Mean IoU of ~0.85 here is against large, isolated,
  high-contrast markers. The acceptance gate measured real cards and found localisation
  degrading well before recognition, with boxes that merge labels into values. The mapping
  being correct does not make a loose box tight.
- **It says nothing about rotation, EXIF orientation or skew.** All three cards are
  upright and unrotated. A phone capture carrying an EXIF orientation flag is a separate
  question, and one that will move crops just as visibly.
- **It does not rule out an internal crop for aspect ratios beyond those tested.** 16:10 and
  3:4 are ordinary card-photo shapes. A very long panorama could take a different path.

## Reproducing

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/ocr-gate/requirements.txt
.venv/bin/python tools/ocr-gate/render_cards.py
OCR_ENDPOINT=http://<host>:<port> OCR_MODEL=<id> \
  pnpm vitest run tools/ocr-gate/calibrate.test.ts
```

`observed.json` is committed, so `tests/domain/ocr/geometry.test.ts` re-verifies the
mapping on every run with no server present.
