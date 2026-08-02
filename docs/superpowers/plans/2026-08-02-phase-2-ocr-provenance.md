# Phase 2 — OCR and Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An applicant photographs an identity document and the fields that document can answer arrive pre-filled, each showing where it came from and inviting a check.

**Architecture:** Six stages — pre-flight quality band, transport, `OcrService.read`, extraction, confidence, dispatch. Extraction and confidence are pure functions in `src/domain/ocr/`; only the service touches the network; only the upload control touches the browser. Three extraction strategies (AAMVA cards, passport MRZ, labelled documents) sit behind one `DocType`-keyed registry.

**Tech Stack:** TypeScript 5.7, Next.js 15 App Router, React 19, Zod 3, Vitest 2 with jsdom, pnpm. DeepSeek-OCR served over an OpenAI-compatible endpoint (LM Studio in development).

**Spec:** `docs/superpowers/specs/2026-08-02-phase-2-ocr-provenance-design.md`
**Gate result:** `docs/superpowers/decisions/2026-08-02-ocr-acceptance-gate.md`

## Global Constraints

- **Package manager is pnpm.** `pnpm test`, `pnpm typecheck`, `pnpm build`. Never `npm`.
- **No test may require LM Studio.** Provider responses are recorded fixtures. The two tasks that hit a live server (3 and 4) are opt-in via an env var and skipped by default.
- **No hardcoded hosts, ports or model ids.** `OCR_ENDPOINT` and `OCR_MODEL` come from the environment with no defaults, as `src/server/ocr/client.ts` already requires of its callers.
- **Comments are short and sparse.** Warnings and non-obvious reasoning only. No essays, no cross-references to spec sections.
- **Files have one reason to change.** Split anything that grows a second.
- **Domain code stays pure.** No `fetch`, no `Date.now()`, no environment reads under `src/domain/`. `tests/domain/purity.test.ts` enforces this — check it before adding a file there.
- **`RequirementKey`, not `FieldId`,** in every application-facing signature. Use `reqKey(id, instance)` from `src/domain/requirements/key.ts`.
- **The server never persists a document image.** It is held for the request and discarded.
- **A field that cannot be extracted is not an error.** It is asked for exactly as it is today. There is no OCR failure state anywhere in the UI.
- **Confidence never removes a confirmation.** Every OCR value lands as `derived` and needs an individual confirmation. No bulk confirmation is added at any score.
- Every task ends green: `pnpm test` and `pnpm typecheck` both pass before the commit.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/domain/ocr/quality.ts` | Pixel width → quality band; detection-extent demotion |
| `src/domain/ocr/geometry.ts` | Normalised model space → original-image pixels |
| `src/domain/ocr/confidence.ts` | Evidence → score |
| `src/domain/ocr/extract/types.ts` | `Candidate`, `Evidence`, `ExtractStrategy` |
| `src/domain/ocr/extract/index.ts` | `DocType` → strategy registry; schema parsing |
| `src/domain/ocr/extract/synonyms.ts` | Label tables — data, not code |
| `src/domain/ocr/extract/aamva.ts` | Label-anchored card extraction |
| `src/domain/ocr/extract/mrz.ts` | TD3 fixed-offset parse and check digits |
| `src/domain/ocr/extract/labelled.ts` | Synonym-table extraction for unstructured documents |
| `src/server/ocr/service.ts` | Two-pass read, provider seam |
| `src/server/document-service.ts` | Upload → read → extract → actions |
| `src/app/api/application/[id]/documents/route.ts` | Upload endpoint |
| `src/ui/panel/DocumentCrop.tsx` | Clip the client-held original to a box |
| `src/ui/panel/DocumentUpload.tsx` | File input, pre-flight, capture copy |
| `sample/licenses/fixtures/*.json` | Recorded OCR responses |

**Modified**

| File | Change |
|---|---|
| `src/ui/panel/Provenance.tsx` | Confidence phrasing and crop slot |
| `src/ui/panel/FieldRow.tsx` | Pass the document image through to `Provenance` |
| `src/ui/panel/ApplicationPanel.tsx` | Accept and thread `documents` |
| `src/app/page.tsx` | Hold uploaded images client-side; wire the upload control |
| `src/domain/catalog/address.ts` | Add `'state_id'` to the four address fields, if Task 4 confirms it |
| `src/server/application-service.ts` | Ownership check (Task 14) |
| `sample/licenses/SOURCES.md` | New specimens with provenance and licence |

---

### Task 1: Quality bands

The gate found recognition and localisation failing at different resolutions, so one threshold cannot serve both. Three bands, and a post-call demotion for a large photo of a small card.

**Files:**
- Create: `src/domain/ocr/quality.ts`
- Test: `tests/domain/ocr/quality.test.ts`

**Interfaces:**
- Consumes: `Box` from `@/domain/ocr/grounding`
- Produces: `type QualityBand = 'full' | 'text-only' | 're-take'`; `bandForWidth(pixelWidth: number): QualityBand`; `demoteForCardExtent(band: QualityBand, detections: readonly Detection[], imageWidth: number): QualityBand`; `CROP_FLOOR_PX = 1000`; `READ_FLOOR_PX = 400`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/ocr/quality.test.ts
import { describe, expect, it } from 'vitest'
import { bandForWidth, demoteForCardExtent } from '@/domain/ocr/quality'
import type { Detection } from '@/domain/ocr/grounding'

describe('bandForWidth', () => {
  it('crops at and above the localisation floor', () => {
    expect(bandForWidth(1012)).toBe('full')
    expect(bandForWidth(1000)).toBe('full')
  })

  it('reads without crops in the band where grounding fails but text survives', () => {
    // The gate measured 12/12 fields read and 3/12 boxes placed at 405px.
    expect(bandForWidth(999)).toBe('text-only')
    expect(bandForWidth(405)).toBe('text-only')
    expect(bandForWidth(400)).toBe('text-only')
  })

  it('asks for another photo below the recognition floor', () => {
    expect(bandForWidth(399)).toBe('re-take')
    expect(bandForWidth(202)).toBe('re-take')
    expect(bandForWidth(0)).toBe('re-take')
  })
})

describe('demoteForCardExtent', () => {
  const spanning = (x0: number, x1: number): Detection =>
    ({ text: 'X', box: [x0, 0, x1, 100] })

  it('keeps full when the card fills most of the frame', () => {
    const detections = [spanning(20, 980)]
    expect(demoteForCardExtent('full', detections, 2000)).toBe('full')
  })

  it('demotes a large photo of a small card', () => {
    // Card occupies 250/1000 of the frame: 2000px image, 500px of card.
    const detections = [spanning(400, 650)]
    expect(demoteForCardExtent('full', detections, 2000)).toBe('text-only')
  })

  it('never promotes', () => {
    const detections = [spanning(0, 1000)]
    expect(demoteForCardExtent('text-only', detections, 4000)).toBe('text-only')
  })

  it('demotes when nothing was detected at all', () => {
    expect(demoteForCardExtent('full', [], 2000)).toBe('text-only')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test quality`
Expected: FAIL — cannot resolve `@/domain/ocr/quality`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/ocr/quality.ts
import type { Detection } from './grounding'

/**
 * Recognition and localisation fail at different resolutions. Measured
 * 2026-08-02: 12/12 fields read at 405px, 3/12 boxes within IoU 0.5.
 */
export const CROP_FLOOR_PX = 1000
export const READ_FLOOR_PX = 400

export type QualityBand = 'full' | 'text-only' | 're-take'

export function bandForWidth(pixelWidth: number): QualityBand {
  if (pixelWidth >= CROP_FLOOR_PX) return 'full'
  if (pixelWidth >= READ_FLOOR_PX) return 'text-only'
  return 're-take'
}

/**
 * Image width stands in for card width before the call. Afterwards the spread
 * of detections says how much of the frame the card actually filled — a big
 * photo of a distant card reads fine and crops wrong.
 */
export function demoteForCardExtent(
  band: QualityBand,
  detections: readonly Detection[],
  imageWidth: number,
): QualityBand {
  if (band !== 'full') return band
  if (detections.length === 0) return 'text-only'

  const left = Math.min(...detections.map((d) => d.box[0]))
  const right = Math.max(...detections.map((d) => d.box[2]))
  const cardWidth = ((right - left) / 1000) * imageWidth

  return cardWidth >= CROP_FLOOR_PX ? 'full' : 'text-only'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test quality && pnpm typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ocr/quality.ts tests/domain/ocr/quality.test.ts
git commit -m "feat(ocr): band an upload by what its resolution can support"
```

---

### Task 2: Coordinate geometry

Grounding coordinates are normalised 0–1000 against the model's own square input. Mapping them back to original-image pixels is new and unproven — this task builds the mapping with the fit model as an explicit parameter; Task 3 settles which parameter is right.

**Files:**
- Create: `src/domain/ocr/geometry.ts`
- Test: `tests/domain/ocr/geometry.test.ts`

**Interfaces:**
- Consumes: `Box` from `@/domain/ocr/grounding`
- Produces: `type ImageSize = { width: number; height: number }`; `type FitModel = 'stretch' | 'pad'`; `toPixels(box: Box, size: ImageSize, fit: FitModel): PixelBox`; `type PixelBox = { x: number; y: number; width: number; height: number }`; `isPlausibleBox(box: Box): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/ocr/geometry.test.ts
import { describe, expect, it } from 'vitest'
import { isPlausibleBox, toPixels } from '@/domain/ocr/geometry'
import type { Box } from '@/domain/ocr/grounding'

describe('toPixels — stretch', () => {
  it('maps a full-extent box to the whole image', () => {
    const result = toPixels([0, 0, 1000, 1000], { width: 1600, height: 1000 }, 'stretch')
    expect(result).toEqual({ x: 0, y: 0, width: 1600, height: 1000 })
  })

  it('maps a quarter box proportionally on each axis', () => {
    const result = toPixels([250, 500, 500, 750], { width: 800, height: 400 }, 'stretch')
    expect(result).toEqual({ x: 200, y: 200, width: 200, height: 100 })
  })
})

describe('toPixels — pad', () => {
  it('removes the letterbox band on the short axis', () => {
    // 1600x800 padded to a 1600x1600 square: 400px band top and bottom.
    // Normalised y 250..750 is the padded square's middle half, which is
    // exactly the image.
    const result = toPixels([0, 250, 1000, 750], { width: 1600, height: 800 }, 'pad')
    expect(result).toEqual({ x: 0, y: 0, width: 1600, height: 800 })
  })

  it('leaves the long axis untouched', () => {
    const result = toPixels([0, 250, 500, 750], { width: 1600, height: 800 }, 'pad')
    expect(result.x).toBe(0)
    expect(result.width).toBe(800)
  })

  it('clamps a box that lands inside the padding', () => {
    const result = toPixels([0, 0, 1000, 100], { width: 1600, height: 800 }, 'pad')
    expect(result.y).toBe(0)
    expect(result.height).toBe(0)
  })
})

describe('round-trip', () => {
  const sizes: Array<{ width: number; height: number }> = [
    { width: 1600, height: 1000 }, { width: 640, height: 480 },
    { width: 1000, height: 1000 }, { width: 480, height: 1600 },
    { width: 3024, height: 4032 },
  ]

  it('never leaves the image, for any size or fit', () => {
    const boxes: Box[] = [
      [0, 0, 1000, 1000], [0, 0, 1, 1], [999, 999, 1000, 1000],
      [250, 250, 750, 750], [100, 900, 200, 950],
    ]

    for (const size of sizes) {
      for (const fit of ['stretch', 'pad'] as const) {
        for (const box of boxes) {
          const r = toPixels(box, size, fit)
          expect(r.x).toBeGreaterThanOrEqual(0)
          expect(r.y).toBeGreaterThanOrEqual(0)
          expect(r.x + r.width).toBeLessThanOrEqual(size.width)
          expect(r.y + r.height).toBeLessThanOrEqual(size.height)
          expect(r.width).toBeGreaterThanOrEqual(0)
          expect(r.height).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('isPlausibleBox', () => {
  it('rejects an inverted box', () => {
    expect(isPlausibleBox([500, 500, 100, 600])).toBe(false)
  })

  it('rejects a box covering nearly the whole card', () => {
    expect(isPlausibleBox([0, 0, 1000, 1000])).toBe(false)
  })

  it('accepts an ordinary field box', () => {
    expect(isPlausibleBox([120, 300, 480, 340])).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test geometry`
Expected: FAIL — cannot resolve `@/domain/ocr/geometry`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/ocr/geometry.ts
import type { Box } from './grounding'

export type ImageSize = { readonly width: number; readonly height: number }
export type PixelBox = {
  readonly x: number; readonly y: number
  readonly width: number; readonly height: number
}

/**
 * Whether the server scaled the image to a square or padded it to one. Wrong
 * choice puts every crop off by a letterbox band. Settled by calibration, not
 * assumption.
 */
export type FitModel = 'stretch' | 'pad'

const SCALE = 1000

export function toPixels(box: Box, size: ImageSize, fit: FitModel): PixelBox {
  const [x0, y0, x1, y1] = box
  if (fit === 'stretch') {
    return clamp(
      (x0 / SCALE) * size.width, (y0 / SCALE) * size.height,
      (x1 / SCALE) * size.width, (y1 / SCALE) * size.height,
      size,
    )
  }

  // Padded to a square of the longer side, image centred.
  const side = Math.max(size.width, size.height)
  const offsetX = (side - size.width) / 2
  const offsetY = (side - size.height) / 2

  return clamp(
    (x0 / SCALE) * side - offsetX, (y0 / SCALE) * side - offsetY,
    (x1 / SCALE) * side - offsetX, (y1 / SCALE) * side - offsetY,
    size,
  )
}

function clamp(
  x0: number, y0: number, x1: number, y1: number, size: ImageSize,
): PixelBox {
  const left = Math.min(Math.max(x0, 0), size.width)
  const top = Math.min(Math.max(y0, 0), size.height)
  const right = Math.min(Math.max(x1, 0), size.width)
  const bottom = Math.min(Math.max(y1, 0), size.height)

  return {
    x: left, y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/** A box the size of the whole card is a detection failure wearing a box. */
export function isPlausibleBox(box: Box): boolean {
  const [x0, y0, x1, y1] = box
  if (x1 <= x0 || y1 <= y0) return false
  const coverage = ((x1 - x0) * (y1 - y0)) / (SCALE * SCALE)
  return coverage < 0.6
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test geometry && pnpm typecheck`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ocr/geometry.ts tests/domain/ocr/geometry.test.ts
git commit -m "feat(ocr): map grounding coordinates back to the image they came from"
```

---

### Task 3: Settle the fit model empirically

Task 2 supports both fit models. Only one is correct, and guessing puts every crop off by a letterbox band. This task measures it. **Requires a running OCR endpoint.**

**Files:**
- Create: `tools/ocr-gate/calibrate.ts`
- Create: `docs/superpowers/decisions/2026-08-02-ocr-fit-model.md`
- Modify: `src/domain/ocr/geometry.ts` (export the settled default)
- Test: `tests/domain/ocr/geometry.test.ts` (assert the default)

**Interfaces:**
- Consumes: `requestOcr` from `@/server/ocr/client`; `toPixels`, `FitModel` from `@/domain/ocr/geometry`; `intersectionOverUnion` from `@/domain/ocr/grounding`
- Produces: `FIT_MODEL: FitModel` exported from `src/domain/ocr/geometry.ts`

- [ ] **Step 1: Render calibration cards**

Extend `tools/ocr-gate/render_cards.py` to emit a calibration card carrying four marker
strings at known pixel positions, one near each edge:

| Marker | Position |
|---|---|
| `MARKERNORTH` | centred, 5% from the top |
| `MARKERSOUTH` | centred, 5% from the bottom |
| `MARKERWEST` | left-aligned, vertically centred |
| `MARKEREAST` | right-aligned, vertically centred |

The strings are long, alphabetic and mutually dissimilar so `findValue` cannot confuse
them, and each appears exactly once so there is no duplicate-box ambiguity. Vertical
markers are what separate the two fit models — a letterbox band moves `y` and leaves `x`
alone.

Render at three aspect ratios — 1:1, 16:10 and 3:4 — all at least 1200px on the long
edge, so resolution is never the confound. Write the true pixel boxes from the renderer's
own text metrics to `sample/licenses/calibration/truth.json`:

```json
[
  {
    "image": "sample/licenses/calibration/square.png",
    "size": { "width": 1200, "height": 1200 },
    "markers": { "MARKERNORTH": [480, 54, 720, 90] }
  }
]
```

The 1:1 render is the control: both fit models agree on a square, so if it scores badly
the problem is elsewhere and the non-square numbers mean nothing.

- [ ] **Step 2: Write the calibration script**

```ts
// tools/ocr-gate/calibrate.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { requestOcr } from '../../src/server/ocr/client'
import { findValue } from '../../src/domain/ocr/grounding'
import { intersectionOverUnion } from '../../src/domain/ocr/grounding'
import { toPixels, type FitModel, type ImageSize } from '../../src/domain/ocr/geometry'

const endpoint = process.env.OCR_ENDPOINT
const model = process.env.OCR_MODEL
if (!endpoint || !model) throw new Error('Set OCR_ENDPOINT and OCR_MODEL')

type Truth = {
  readonly image: string
  readonly size: ImageSize
  readonly markers: Record<string, [number, number, number, number]>
}

const truths: Truth[] = JSON.parse(
  readFileSync('sample/licenses/calibration/truth.json', 'utf8'),
)

const observed: Record<string, Record<string, number[]>> = {}

for (const truth of truths) {
  const imageBase64 = readFileSync(truth.image).toString('base64')
  const { detections } = await requestOcr({ endpoint, model, imageBase64 })

  // Kept so the geometry test can re-check the mapping without a server.
  observed[truth.image] = {}
  for (const marker of Object.keys(truth.markers)) {
    const found = findValue(detections, marker)
    if (found) observed[truth.image]![marker] = [...found.box]
  }

  for (const fit of ['stretch', 'pad'] as FitModel[]) {
    const scores: number[] = []
    for (const [text, trueBox] of Object.entries(truth.markers)) {
      const found = findValue(detections, text)
      if (!found) continue
      const mapped = toPixels(found.box, truth.size, fit)
      scores.push(intersectionOverUnion(
        [mapped.x, mapped.y, mapped.x + mapped.width, mapped.y + mapped.height],
        trueBox,
      ))
    }
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
    console.log(`${truth.image} ${fit}: mean IoU ${mean.toFixed(3)} over ${scores.length}`)
  }
}

writeFileSync(
  'sample/licenses/calibration/observed.json',
  JSON.stringify(observed, null, 2),
)
```

- [ ] **Step 3: Run it and read the result**

Run: `OCR_ENDPOINT=... OCR_MODEL=... pnpm exec tsx tools/ocr-gate/calibrate.ts`

Expected: the two fit models score identically on the 1:1 card and differ on the non-square ones. The winner is whichever has the higher mean IoU on 16:10 and 3:4.

If both score below 0.5 on non-square cards, neither model is right — stop and record that. A third possibility is that the server crops rather than fits, which needs its own model, and inventing one without evidence is how a wrong crop ships.

- [ ] **Step 4: Record the decision**

Write `docs/superpowers/decisions/2026-08-02-ocr-fit-model.md` with the per-aspect IoU table, the chosen model, and the raw numbers. Follow the existing gate decision doc: state what was measured, what it means, and what it does not license.

- [ ] **Step 5: Pin the result in code and test**

```ts
// src/domain/ocr/geometry.ts — append
/** Measured 2026-08-02; see the fit-model decision record. */
export const FIT_MODEL: FitModel = 'pad'
```

```ts
// tests/domain/ocr/geometry.test.ts — append
import { readFileSync } from 'node:fs'
import { FIT_MODEL } from '@/domain/ocr/geometry'
import { intersectionOverUnion } from '@/domain/ocr/grounding'

it('maps a measured marker back onto where it was actually printed', () => {
  // Asserting FIT_MODEL is one of two strings would pass whichever we picked.
  // This asserts the mapping lands on the marker, which is the thing at stake.
  const [truth] = JSON.parse(
    readFileSync('sample/licenses/calibration/truth.json', 'utf8'),
  )
  const observed = JSON.parse(
    readFileSync('sample/licenses/calibration/observed.json', 'utf8'),
  )

  for (const [marker, trueBox] of Object.entries(truth.markers)) {
    const box = observed[truth.image]?.[marker]
    if (!box) continue
    const m = toPixels(box, truth.size, FIT_MODEL)
    const iou = intersectionOverUnion(
      [m.x, m.y, m.x + m.width, m.y + m.height], trueBox as never,
    )
    expect(iou).toBeGreaterThan(0.5)
  }
})
```

`calibrate.ts` writes `observed.json` — the raw normalised boxes it got back, keyed by
image and marker — alongside its console output. That file is what makes this test
reproducible without a server.

- [ ] **Step 6: Run and commit**

```bash
pnpm test geometry && pnpm typecheck
git add tools/ocr-gate/calibrate.ts tools/ocr-gate/render_cards.py \
        sample/licenses/calibration docs/superpowers/decisions/2026-08-02-ocr-fit-model.md \
        src/domain/ocr/geometry.ts tests/domain/ocr/geometry.test.ts
git commit -m "fix(ocr): settle the fit model by measuring it, not assuming it"
```

---

### Task 4: Fixture corpus

Extractors need documents to be tested against, and four AAMVA cards do not cover five document types. **Requires a running OCR endpoint for the recording step.**

**Files:**
- Create: `sample/licenses/specimens/*` (new specimens)
- Create: `sample/licenses/fixtures/*.json` (recorded responses)
- Create: `tools/ocr-gate/record.ts`
- Modify: `sample/licenses/SOURCES.md`
- Modify: `src/domain/catalog/address.ts` (conditionally — see Step 4)

**Interfaces:**
- Produces: `sample/licenses/fixtures/<slug>.json` shaped `{ docType, imageSize, text, detections }`, loaded directly by later tests

- [ ] **Step 1: Source specimens**

Sourcing rule, unchanged from the existing four: official specimens printed with a placeholder identity, **never a real person's document**.

| Need | Where to look |
|---|---|
| 3–4 more AAMVA cards, varied states | State DMV sites publish specimen card images; Wikimedia Commons mirrors many |
| One passport with a readable MRZ | ICAO Doc 9303 specimen pages; State Department sample passport |
| One dealer licence | State dealer handbooks sometimes embed a sample certificate |
| Two proof-of-residency documents | Published utility bill and bank statement templates |

If no dealer licence specimen exists publicly, build a synthetic one with `render_cards.py` and **label it synthetic in SOURCES.md**. A synthetic fixture that is described as real is worse than a missing one.

- [ ] **Step 2: Record provenance**

Append to `sample/licenses/SOURCES.md` in the existing table format: file, title, pixel size, licence. Flag anything that is CC BY-SA rather than public domain — the Washington card already carries share-alike terms that constrain derivative crops leaving the company.

- [ ] **Step 3: Record OCR responses as fixtures**

```ts
// tools/ocr-gate/record.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { requestOcr, PLAIN_PROMPT } from '../../src/server/ocr/client'

const endpoint = process.env.OCR_ENDPOINT
const model = process.env.OCR_MODEL
if (!endpoint || !model) throw new Error('Set OCR_ENDPOINT and OCR_MODEL')

const [file, docType, slug, width, height] = process.argv.slice(2)
if (!file || !docType || !slug || !width || !height) {
  throw new Error('Usage: record.ts <image> <docType> <slug> <width> <height>')
}

const imageBase64 = readFileSync(file).toString('base64')
const grounded = await requestOcr({ endpoint, model, imageBase64 })
const plain = await requestOcr({ endpoint, model, imageBase64, prompt: PLAIN_PROMPT })

writeFileSync(
  `sample/licenses/fixtures/${slug}.json`,
  JSON.stringify({
    docType,
    imageSize: { width: Number(width), height: Number(height) },
    text: grounded.text,
    detections: grounded.detections,
    plainText: plain.text,
  }, null, 2),
)
```

Record one fixture per specimen. These files are what every later extraction test reads, and they are why no test needs LM Studio.

- [ ] **Step 4: Settle the address derivation question**

The four address fields declare `derivableFrom: ['drivers_license']` but not `'state_id'`, while the seven identity fields declare both. Open the state ID specimen. If it prints an address — it will — add `'state_id'` to `addr_line1`, `addr_city`, `addr_state`, `addr_zip` in `src/domain/catalog/address.ts`. Leave `addr_line2` alone; apartment lines are the least reliably printed.

If a state ID in the corpus does *not* print an address, leave the catalog as it is and note why in the commit message.

- [ ] **Step 5: Assert the corpus covers what the plan needs**

```ts
// tests/domain/ocr/fixtures.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const files = readdirSync('sample/licenses/fixtures').filter((f) => f.endsWith('.json'))
const fixtures = files.map((f) =>
  JSON.parse(readFileSync(`sample/licenses/fixtures/${f}`, 'utf8')),
)

describe('fixture corpus', () => {
  it('covers every document type the extractors claim to handle', () => {
    const covered = new Set(fixtures.map((f) => f.docType))
    for (const docType of [
      'drivers_license', 'state_id', 'passport',
      'dealer_license', 'proof_of_residency',
    ]) {
      expect(covered).toContain(docType)
    }
  })

  it('records a size and detections for every fixture', () => {
    for (const f of fixtures) {
      expect(f.imageSize.width).toBeGreaterThan(0)
      expect(Array.isArray(f.detections)).toBe(true)
    }
  })
})
```

- [ ] **Step 6: Run and commit**

```bash
pnpm test fixtures && pnpm typecheck
git add sample/licenses tools/ocr-gate/record.ts tests/domain/ocr/fixtures.test.ts \
        src/domain/catalog/address.ts
git commit -m "test(ocr): record a fixture per specimen, so no test needs a server"
```

---

### Task 5: Extraction contract

The shared types and the registry every strategy plugs into. No strategy yet — this task is the seam that lets the next three be written independently.

**Files:**
- Create: `src/domain/ocr/extract/types.ts`
- Create: `src/domain/ocr/extract/index.ts`
- Test: `tests/domain/ocr/extract/index.test.ts`

**Interfaces:**
- Consumes: `Detection`, `Box`; `RequirementKey`, `reqKey`, `parseReqKey`; `fieldDef` from `@/domain/catalog`; `DocType` from `@/domain/field-id`
- Produces:
  - `type Evidence = { schemaParsed: boolean; labelAnchored: boolean; checksumValid: boolean | null; crossPassAgreed: boolean | null; boxPlausible: boolean | null }`
  - `type Candidate = { key: RequirementKey; raw: string; box?: Box; evidence: Evidence }`
  - `type ExtractStrategy = (detections: readonly Detection[], text: string) => readonly Candidate[]`
  - `registerStrategy(docType: DocType, strategy: ExtractStrategy): void`
  - `extractFor(docType: DocType, detections: readonly Detection[], text: string): readonly Candidate[]`
  - `parseCandidates(candidates: readonly Candidate[]): readonly Candidate[]` — drops anything whose value fails its catalog schema

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/ocr/extract/index.test.ts
import { describe, expect, it } from 'vitest'
import { extractFor, parseCandidates, registerStrategy } from '@/domain/ocr/extract'
import type { Candidate, Evidence } from '@/domain/ocr/extract/types'

const noEvidence: Evidence = {
  schemaParsed: false, labelAnchored: false,
  checksumValid: null, crossPassAgreed: null, boxPlausible: null,
}

const candidate = (key: string, raw: string): Candidate =>
  ({ key, raw, evidence: { ...noEvidence } })

describe('extractFor', () => {
  it('returns nothing for a document type with no strategy', () => {
    expect(extractFor('proof_of_residency', [], '')).toEqual([])
  })

  it('routes to the registered strategy', () => {
    registerStrategy('state_id', () => [candidate('first_name', 'JAMIE')])
    const out = extractFor('state_id', [], '')
    expect(out).toHaveLength(1)
    expect(out[0]?.key).toBe('first_name')
  })
})

describe('parseCandidates', () => {
  it('keeps a value its field schema accepts, and records that it parsed', () => {
    const [kept] = parseCandidates([candidate('dob', '1982-04-17')])
    expect(kept?.raw).toBe('1982-04-17')
    expect(kept?.evidence.schemaParsed).toBe(true)
  })

  it('drops a value the schema rejects rather than lowering its score', () => {
    // A date that is not a date is not a low-confidence date.
    expect(parseCandidates([candidate('dob', '1982-13-45')])).toEqual([])
  })

  it('drops a licence number too short to be one', () => {
    expect(parseCandidates([candidate('dl_number', 'A1')])).toEqual([])
  })

  it('parses an instanced key against its bare field definition', () => {
    const kept = parseCandidates([candidate('license_number#0', 'GA-DLR-99481')])
    expect(kept).toHaveLength(1)
  })

  it('drops a candidate for a field that is not in the catalog', () => {
    expect(parseCandidates([candidate('not_a_field', 'x')])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test extract`
Expected: FAIL — cannot resolve `@/domain/ocr/extract`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/ocr/extract/types.ts
import type { RequirementKey } from '@/domain/requirements/key'
import type { Box, Detection } from '../grounding'

/**
 * What we observed about how a value was obtained. `null` means the signal
 * does not apply to this document — a card has no checksum — which is not the
 * same as failing it.
 */
export type Evidence = {
  readonly schemaParsed: boolean
  readonly labelAnchored: boolean
  readonly checksumValid: boolean | null
  readonly crossPassAgreed: boolean | null
  readonly boxPlausible: boolean | null
}

export type Candidate = {
  readonly key: RequirementKey
  readonly raw: string
  readonly box?: Box
  readonly evidence: Evidence
}

export type ExtractStrategy = (
  detections: readonly Detection[],
  text: string,
) => readonly Candidate[]

export const NO_EVIDENCE: Evidence = {
  schemaParsed: false, labelAnchored: false,
  checksumValid: null, crossPassAgreed: null, boxPlausible: null,
}
```

```ts
// src/domain/ocr/extract/index.ts
import { CATALOG } from '@/domain/catalog'
import { parseReqKey } from '@/domain/requirements/key'
import type { DocType } from '@/domain/field-id'
import type { Detection } from '../grounding'
import type { Candidate, ExtractStrategy } from './types'

export type { Candidate, Evidence, ExtractStrategy } from './types'
export { NO_EVIDENCE } from './types'

const strategies = new Map<DocType, ExtractStrategy>()

export function registerStrategy(docType: DocType, strategy: ExtractStrategy): void {
  strategies.set(docType, strategy)
}

/** No strategy is not an error: the fields get asked for as they are today. */
export function extractFor(
  docType: DocType,
  detections: readonly Detection[],
  text: string,
): readonly Candidate[] {
  return strategies.get(docType)?.(detections, text) ?? []
}

/**
 * A value its own field rejects is dropped, not scored low. A malformed read
 * is not a read we are slightly unsure about.
 */
export function parseCandidates(
  candidates: readonly Candidate[],
): readonly Candidate[] {
  const kept: Candidate[] = []

  for (const candidate of candidates) {
    let bareId
    try {
      bareId = parseReqKey(candidate.key).fieldId
    } catch {
      continue
    }

    const def = CATALOG.get(bareId)
    if (!def || !def.validation.safeParse(candidate.raw).success) continue

    kept.push({ ...candidate, evidence: { ...candidate.evidence, schemaParsed: true } })
  }

  return kept
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test extract && pnpm typecheck`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ocr/extract tests/domain/ocr/extract
git commit -m "feat(ocr): give the three extractors one contract to plug into"
```

---

### Task 6: AAMVA card extractor

Label-anchored extraction for driver's licences and state IDs. `findValue` already handles the two behaviours the gate found — merged label-and-value, and the same number printed twice.

**Files:**
- Create: `src/domain/ocr/extract/synonyms.ts`
- Create: `src/domain/ocr/extract/aamva.ts`
- Test: `tests/domain/ocr/extract/aamva.test.ts`

**Interfaces:**
- Consumes: `findValue`, `normalizeText`, `Detection`; `isPlausibleBox`; `Candidate`, `NO_EVIDENCE`, `registerStrategy`
- Produces: `AAMVA_ANCHORS: Readonly<Record<string, readonly string[]>>`; `extractAamva: ExtractStrategy`; `splitAddressBlock(raw: string): { line1?: string; city?: string; state?: string; zip?: string }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/ocr/extract/aamva.test.ts
import { describe, expect, it } from 'vitest'
import { extractAamva, splitAddressBlock } from '@/domain/ocr/extract/aamva'
import type { Detection } from '@/domain/ocr/grounding'

const det = (text: string, box: [number, number, number, number]): Detection =>
  ({ text, box })

describe('extractAamva', () => {
  it('reads a licence number anchored to its field code', () => {
    const detections = [det('4dLIC#WDLJK00580GF', [100, 200, 400, 230])]
    const out = extractAamva(detections, '')
    const found = out.find((c) => c.key === 'dl_number')
    expect(found?.raw).toBe('WDLJK00580GF')
  })

  it('picks the labelled occurrence when the number is printed twice', () => {
    // Washington prints it as `4d LIC#` at the top and `5 DD` at the bottom.
    // Value alone picks the wrong one about half the time.
    const detections = [
      det('4dLIC#WDLJK00580GF', [100, 200, 400, 230]),
      det('5DDWDLJK00580GF', [100, 700, 400, 730]),
    ]
    const found = extractAamva(detections, '').find((c) => c.key === 'dl_number')
    expect(found?.box).toEqual([100, 200, 400, 230])
    expect(found?.evidence.labelAnchored).toBe(true)
  })

  it('reads dates into ISO form', () => {
    const detections = [det('3 DOB 04/17/1982', [100, 300, 400, 330])]
    const found = extractAamva(detections, '').find((c) => c.key === 'dob')
    expect(found?.raw).toBe('1982-04-17')
  })

  it('marks a box covering the whole card as implausible', () => {
    const detections = [det('4dLIC#WDLJK00580GF', [0, 0, 1000, 1000])]
    const found = extractAamva(detections, '').find((c) => c.key === 'dl_number')
    expect(found?.evidence.boxPlausible).toBe(false)
  })

  it('emits nothing for a field whose anchor is absent', () => {
    const out = extractAamva([det('SOMETHING ELSE', [0, 0, 10, 10])], '')
    expect(out).toEqual([])
  })
})

describe('splitAddressBlock', () => {
  it('splits a two-line address block', () => {
    const parts = splitAddressBlock('2600 MARTIN WAY E\nOLYMPIA, WA 98506')
    expect(parts).toEqual({
      line1: '2600 MARTIN WAY E', city: 'OLYMPIA', state: 'WA', zip: '98506',
    })
  })

  it('handles a ZIP+4', () => {
    expect(splitAddressBlock('1 A ST\nBOSTON, MA 02101-1234').zip).toBe('02101-1234')
  })

  it('returns nothing usable from a malformed block', () => {
    expect(splitAddressBlock('ANYTOWN,CAPO')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test aamva`
Expected: FAIL — cannot resolve `@/domain/ocr/extract/aamva`.

- [ ] **Step 3: Write the synonym table**

```ts
// src/domain/ocr/extract/synonyms.ts
/**
 * Printed field codes, per AAMVA. Data rather than code so a new state's
 * variant is a one-line change with no logic to re-read.
 */
export const AAMVA_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  dl_number: ['4d', 'LIC#', 'DLN', 'LICNO', 'DLNO', 'NO'],
  dob: ['3', 'DOB'],
  dl_expiry: ['4b', 'EXP', 'EXPIRES'],
  last_name: ['1', 'LN'],
  first_name: ['2', 'FN'],
  address_block: ['8', 'ADD'],
}

export const LABELLED_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  license_number: ['LICENSENO', 'LICENSENUMBER', 'LIC#', 'LICENCENO', 'DEALERNO'],
  license_effective: ['EFFECTIVE', 'ISSUED', 'ISSUEDATE', 'VALIDFROM'],
  license_expiry: ['EXPIRES', 'EXPIRATION', 'VALIDTHROUGH', 'VALIDUNTIL'],
  biz_legal_name: ['LEGALNAME', 'BUSINESSNAME', 'ENTITYNAME', 'DBA'],
}
```

- [ ] **Step 4: Write the extractor**

```ts
// src/domain/ocr/extract/aamva.ts
import { isPlausibleBox } from '../geometry'
import { findValue, normalizeText, type Detection } from '../grounding'
import { registerStrategy } from './index'
import { AAMVA_ANCHORS } from './synonyms'
import { NO_EVIDENCE, type Candidate, type ExtractStrategy } from './types'

const US_DATE = /(\d{2})[/-](\d{2})[/-](\d{4})/

/** Cards print MM/DD/YYYY; every field schema wants ISO. */
function toIsoDate(raw: string): string | null {
  const match = US_DATE.exec(raw)
  if (!match) return null
  const [, month, day, year] = match
  return `${year}-${month}-${day}`
}

export function splitAddressBlock(raw: string): {
  line1?: string; city?: string; state?: string; zip?: string
} {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return {}

  const last = lines[lines.length - 1] ?? ''
  const match = /^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(last)
  if (!match) return {}

  return {
    line1: lines.slice(0, -1).join(' '),
    city: match[1], state: match[2], zip: match[3],
  }
}

/** Anchoring finds the detection; the anchor text then has to come off it. */
function stripAnchor(text: string, anchors: readonly string[]): string {
  const normalized = normalizeText(text)
  for (const anchor of anchors) {
    const at = normalized.indexOf(normalizeText(anchor))
    if (at === 0) return normalized.slice(normalizeText(anchor).length)
  }
  return normalized
}

export const extractAamva: ExtractStrategy = (detections) => {
  const out: Candidate[] = []

  for (const [key, anchors] of Object.entries(AAMVA_ANCHORS)) {
    const detection = anchoredDetection(detections, anchors)
    if (!detection) continue

    const value = stripAnchor(detection.text, anchors)
    const evidence = {
      ...NO_EVIDENCE,
      labelAnchored: true,
      boxPlausible: isPlausibleBox(detection.box),
    }

    if (key === 'address_block') {
      const parts = splitAddressBlock(detection.text)
      for (const [field, raw] of [
        ['addr_line1', parts.line1], ['addr_city', parts.city],
        ['addr_state', parts.state], ['addr_zip', parts.zip],
      ] as const) {
        if (raw) out.push({ key: field, raw, box: detection.box, evidence })
      }
      continue
    }

    const raw = key === 'dob' || key === 'dl_expiry'
      ? toIsoDate(detection.text)
      : value
    if (raw) out.push({ key, raw, box: detection.box, evidence })
  }

  return out
}

function anchoredDetection(
  detections: readonly Detection[],
  anchors: readonly string[],
): Detection | null {
  for (const anchor of anchors) {
    const normalized = normalizeText(anchor)
    const hit = detections.find((d) => normalizeText(d.text).startsWith(normalized))
    if (hit) return hit
  }
  return null
}

registerStrategy('drivers_license', extractAamva)
registerStrategy('state_id', extractAamva)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test aamva && pnpm typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 6: Measure against the real fixtures**

```ts
// tests/domain/ocr/extract/aamva-recall.test.ts
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractAamva } from '@/domain/ocr/extract/aamva'
import { parseCandidates } from '@/domain/ocr/extract'

const cards = readdirSync('sample/licenses/fixtures')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`sample/licenses/fixtures/${f}`, 'utf8')))
  .filter((f) => f.docType === 'drivers_license' || f.docType === 'state_id')

describe('AAMVA recall against recorded specimens', () => {
  it('reads a licence number from every card in the corpus', () => {
    for (const card of cards) {
      const out = parseCandidates(extractAamva(card.detections, card.text))
      expect(out.map((c) => c.key)).toContain('dl_number')
    }
  })
})
```

If a card in the corpus fails, add its printed variant to `AAMVA_ANCHORS` — that is the table's whole purpose — and note which card needed it.

- [ ] **Step 7: Commit**

```bash
git add src/domain/ocr/extract/aamva.ts src/domain/ocr/extract/synonyms.ts \
        tests/domain/ocr/extract/aamva.test.ts tests/domain/ocr/extract/aamva-recall.test.ts
git commit -m "feat(ocr): read a licence card by the codes printed on it"
```

---

### Task 7: Passport MRZ extractor

The only document in the set that can verify its own reading. A field whose check digit fails is not emitted at all.

**Files:**
- Create: `src/domain/ocr/extract/mrz.ts`
- Test: `tests/domain/ocr/extract/mrz.test.ts`

**Interfaces:**
- Consumes: `registerStrategy`, `NO_EVIDENCE`, `Candidate`, `ExtractStrategy`
- Produces: `checkDigit(input: string): string`; `findMrzLines(text: string): readonly [string, string] | null`; `extractMrz: ExtractStrategy`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/ocr/extract/mrz.test.ts
import { describe, expect, it } from 'vitest'
import { checkDigit, extractMrz, findMrzLines } from '@/domain/ocr/extract/mrz'

// ICAO Doc 9303 TD3 specimen.
const LINE1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
const LINE2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
const MRZ = `${LINE1}\n${LINE2}`

describe('checkDigit', () => {
  it('computes the documented specimen digits', () => {
    expect(checkDigit('L898902C3')).toBe('6')
    expect(checkDigit('740812')).toBe('2')
    expect(checkDigit('120415')).toBe('9')
  })

  it('treats filler as zero', () => {
    expect(checkDigit('<<<<<<')).toBe('0')
  })
})

describe('findMrzLines', () => {
  it('finds the two lines inside surrounding page text', () => {
    const found = findMrzLines(`PASSPORT\nUNITED STATES\n${MRZ}\n`)
    expect(found?.[0]).toBe(LINE1)
    expect(found?.[1]).toBe(LINE2)
  })

  it('returns null when only one line is present', () => {
    expect(findMrzLines(LINE1)).toBeNull()
  })
})

describe('extractMrz', () => {
  it('reads names, dates and issuing country', () => {
    const out = extractMrz([], MRZ)
    const value = (key: string) => out.find((c) => c.key === key)?.raw

    expect(value('last_name')).toBe('ERIKSSON')
    expect(value('first_name')).toBe('ANNA')
    expect(value('dob')).toBe('1974-08-12')
    expect(value('dl_expiry')).toBe('2012-04-15')
    expect(value('id_country')).toBe('UTO')
  })

  it('marks every emitted field as checksum-validated', () => {
    for (const candidate of extractMrz([], MRZ)) {
      expect(candidate.evidence.checksumValid).toBe(true)
    }
  })

  it('suppresses a field whose check digit fails', () => {
    // The exact failure class the CA card produced: a character misread inside
    // an identifier. Arithmetic catches it; an applicant skimming would not.
    const corrupted = MRZ.replace('7408122', '7408123')
    const out = extractMrz([], corrupted)
    expect(out.find((c) => c.key === 'dob')).toBeUndefined()
    expect(out.find((c) => c.key === 'last_name')).toBeDefined()
  })

  it('emits no box, because an MRZ line is not where the value is printed', () => {
    for (const candidate of extractMrz([], MRZ)) {
      expect(candidate.box).toBeUndefined()
    }
  })

  it('returns nothing when there is no MRZ', () => {
    expect(extractMrz([], 'JUST SOME TEXT')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mrz`
Expected: FAIL — cannot resolve `@/domain/ocr/extract/mrz`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/ocr/extract/mrz.ts
import { registerStrategy } from './index'
import { NO_EVIDENCE, type Candidate, type ExtractStrategy } from './types'

const WEIGHTS = [7, 3, 1]
const LINE = /^[A-Z0-9<]{44}$/

/** ICAO Doc 9303: digits by value, letters A-Z as 10-35, filler as 0. */
export function checkDigit(input: string): string {
  let sum = 0
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? '<'
    const value = char === '<'
      ? 0
      : char >= '0' && char <= '9'
        ? Number(char)
        : char.charCodeAt(0) - 55
    sum += value * (WEIGHTS[i % 3] ?? 1)
  }
  return String(sum % 10)
}

export function findMrzLines(text: string): readonly [string, string] | null {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => LINE.test(l))

  if (lines.length < 2) return null
  const first = lines.find((l) => l.startsWith('P'))
  const second = lines.find((l) => l !== first)
  return first && second ? [first, second] : null
}

/** YYMMDD with the 20-year window ICAO uses for expiry versus birth. */
function toIsoDate(yymmdd: string, kind: 'past' | 'future'): string | null {
  const year = Number(yymmdd.slice(0, 2))
  const month = yymmdd.slice(2, 4)
  const day = yymmdd.slice(4, 6)
  if (Number.isNaN(year)) return null
  const century = kind === 'past' ? (year > 30 ? 1900 : 2000) : 2000
  return `${century + year}-${month}-${day}`
}

export const extractMrz: ExtractStrategy = (_detections, text) => {
  const lines = findMrzLines(text)
  if (!lines) return []
  const [line1, line2] = lines

  const out: Candidate[] = []
  const emit = (key: string, raw: string | null) => {
    if (raw) out.push({ key, raw, evidence: { ...NO_EVIDENCE, checksumValid: true } })
  }

  // Names carry no check digit of their own; the composite covers line 2 only,
  // so a name is emitted whenever the zone parses.
  const names = line1.slice(5).split('<<')
  const surname = (names[0] ?? '').replace(/</g, ' ').trim()
  const given = (names[1] ?? '').split('<')[0]?.trim() ?? ''
  if (surname) emit('last_name', surname)
  if (given) emit('first_name', given)

  const country = line1.slice(2, 5).replace(/</g, '')
  if (country) emit('id_country', country)

  const dob = line2.slice(13, 19)
  if (checkDigit(dob) === line2[19]) emit('dob', toIsoDate(dob, 'past'))

  const expiry = line2.slice(21, 27)
  if (checkDigit(expiry) === line2[27]) emit('dl_expiry', toIsoDate(expiry, 'future'))

  return out
}

registerStrategy('passport', extractMrz)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mrz && pnpm typecheck`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ocr/extract/mrz.ts tests/domain/ocr/extract/mrz.test.ts
git commit -m "feat(ocr): let a passport prove its own reading"
```

---

### Task 8: Labelled-document extractor, and its measured recall

The weakest of the three, deliberately. This task measures how weak rather than assuming.

**Files:**
- Create: `src/domain/ocr/extract/labelled.ts`
- Create: `docs/superpowers/decisions/2026-08-02-labelled-recall.md`
- Test: `tests/domain/ocr/extract/labelled.test.ts`

**Interfaces:**
- Consumes: `LABELLED_ANCHORS`; `findValue`, `normalizeText`; `registerStrategy`, `NO_EVIDENCE`
- Produces: `extractLabelled: ExtractStrategy`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/ocr/extract/labelled.test.ts
import { describe, expect, it } from 'vitest'
import { extractLabelled } from '@/domain/ocr/extract/labelled'
import type { Detection } from '@/domain/ocr/grounding'

const det = (text: string): Detection => ({ text, box: [100, 100, 400, 130] })

describe('extractLabelled', () => {
  it('reads a licence number from its label', () => {
    const out = extractLabelled([det('License No. GA-DLR-99481')], '')
    expect(out.find((c) => c.key === 'license_number#0')?.raw).toBe('GA-DLR-99481')
  })

  it('accepts a spelling variant from the synonym table', () => {
    const out = extractLabelled([det('Licence Number: GA-DLR-99481')], '')
    expect(out.find((c) => c.key === 'license_number#0')?.raw).toBe('GA-DLR-99481')
  })

  it('keys licence fields to instance zero', () => {
    // The requirements engine instances licences; an extractor that emits a
    // bare `license_number` writes to a key nothing asks for.
    const out = extractLabelled([det('License No. X-1')], '')
    for (const candidate of out) {
      expect(candidate.key.startsWith('license_')).toBe(true)
      expect(candidate.key).toContain('#0')
    }
  })

  it('reads an expiry into ISO form', () => {
    const out = extractLabelled([det('Expires 06/30/2027')], '')
    expect(out.find((c) => c.key === 'license_expiry#0')?.raw).toBe('2027-06-30')
  })

  it('never claims a label it did not find', () => {
    expect(extractLabelled([det('UNRELATED TEXT')], '')).toEqual([])
  })

  it('marks its candidates as label-anchored but not checksum-backed', () => {
    const [first] = extractLabelled([det('License No. X-1234')], '')
    expect(first?.evidence.labelAnchored).toBe(true)
    expect(first?.evidence.checksumValid).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test labelled`
Expected: FAIL — cannot resolve `@/domain/ocr/extract/labelled`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/ocr/extract/labelled.ts
import { isPlausibleBox } from '../geometry'
import { normalizeText, type Detection } from '../grounding'
import { reqKey } from '@/domain/requirements/key'
import type { FieldId } from '@/domain/field-id'
import { registerStrategy } from './index'
import { LABELLED_ANCHORS } from './synonyms'
import { NO_EVIDENCE, type Candidate, type ExtractStrategy } from './types'

const US_DATE = /(\d{2})[/-](\d{2})[/-](\d{4})/

const DATE_FIELDS = new Set(['license_effective', 'license_expiry'])
/** The requirements engine instances licences; a bare key answers nothing. */
const INSTANCED = new Set(['license_number', 'license_effective', 'license_expiry'])

export const extractLabelled: ExtractStrategy = (detections) => {
  const out: Candidate[] = []

  for (const [field, anchors] of Object.entries(LABELLED_ANCHORS)) {
    const hit = labelled(detections, anchors)
    if (!hit) continue

    const raw = DATE_FIELDS.has(field) ? isoFrom(hit.value) : hit.value
    if (!raw) continue

    out.push({
      key: INSTANCED.has(field) ? reqKey(field as FieldId, 0) : field,
      raw,
      box: hit.detection.box,
      evidence: {
        ...NO_EVIDENCE,
        labelAnchored: true,
        boxPlausible: isPlausibleBox(hit.detection.box),
      },
    })
  }

  return out
}

function labelled(
  detections: readonly Detection[],
  anchors: readonly string[],
): { detection: Detection; value: string } | null {
  for (const anchor of anchors) {
    const wanted = normalizeText(anchor)
    for (const detection of detections) {
      const normalized = normalizeText(detection.text)
      const at = normalized.indexOf(wanted)
      if (at === -1) continue
      const value = normalized.slice(at + wanted.length).replace(/^[:.]+/, '')
      if (value) return { detection, value }
    }
  }
  return null
}

function isoFrom(raw: string): string | null {
  const match = US_DATE.exec(raw)
  if (!match) return null
  return `${match[3]}-${match[1]}-${match[2]}`
}

registerStrategy('dealer_license', extractLabelled)
registerStrategy('proof_of_residency', extractLabelled)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test labelled && pnpm typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Measure recall on the real fixtures and record it**

```ts
// tests/domain/ocr/extract/labelled-recall.test.ts
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractLabelled } from '@/domain/ocr/extract/labelled'
import { parseCandidates } from '@/domain/ocr/extract'

const docs = readdirSync('sample/licenses/fixtures')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`sample/licenses/fixtures/${f}`, 'utf8')))
  .filter((f) => f.docType === 'dealer_license' || f.docType === 'proof_of_residency')

describe('labelled recall', () => {
  it('records what it managed to read, without pretending it read more', () => {
    for (const doc of docs) {
      const out = parseCandidates(extractLabelled(doc.detections, doc.text))
      // Not an assertion of quality — a record of it. The number goes in the
      // decision doc and decides whether this strategy survives as it is.
      console.log(`${doc.docType}: ${out.length} fields — ${out.map((c) => c.key).join(', ')}`)
      expect(out.length).toBeGreaterThanOrEqual(0)
    }
  })
})
```

Write `docs/superpowers/decisions/2026-08-02-labelled-recall.md` with the per-document field counts and a verdict: keep as is, extend the synonym table, or cut to Phase 2b and swap in a local structuring model behind `ExtractStrategy`. State the number plainly — a low one is a finding, not a failure.

- [ ] **Step 6: Commit**

```bash
git add src/domain/ocr/extract/labelled.ts tests/domain/ocr/extract/labelled.test.ts \
        tests/domain/ocr/extract/labelled-recall.test.ts \
        docs/superpowers/decisions/2026-08-02-labelled-recall.md
git commit -m "feat(ocr): read what a labelled document offers, and measure how little that is"
```

---

### Task 9: Confidence scorer

DeepSeek-OCR returns no confidence. This derives one from what we can observe. Logprobs were rejected in design: `I` read as `1` is a high-probability substitution, so a model-derived score is most confident exactly where it is most wrong.

**Files:**
- Create: `src/domain/ocr/confidence.ts`
- Test: `tests/domain/ocr/confidence.test.ts`

**Interfaces:**
- Consumes: `Evidence`, `Candidate` from `@/domain/ocr/extract/types`
- Produces: `scoreEvidence(evidence: Evidence): number`; `withCrossPass(candidates: readonly Candidate[], plainText: string): readonly Candidate[]`; `QUIET_THRESHOLD = 0.8`

- [ ] **Step 1: Write the failing test**

```ts
// tests/domain/ocr/confidence.test.ts
import { describe, expect, it } from 'vitest'
import { QUIET_THRESHOLD, scoreEvidence, withCrossPass } from '@/domain/ocr/confidence'
import { NO_EVIDENCE } from '@/domain/ocr/extract/types'
import type { Candidate, Evidence } from '@/domain/ocr/extract/types'

const evidence = (patch: Partial<Evidence>): Evidence => ({ ...NO_EVIDENCE, ...patch })

describe('scoreEvidence', () => {
  it('stays within bounds for every combination', () => {
    const flags = [true, false, null] as const
    for (const checksumValid of flags) {
      for (const crossPassAgreed of flags) {
        for (const boxPlausible of flags) {
          for (const labelAnchored of [true, false]) {
            const score = scoreEvidence(evidence({
              schemaParsed: true, labelAnchored,
              checksumValid, crossPassAgreed, boxPlausible,
            }))
            expect(score).toBeGreaterThanOrEqual(0)
            expect(score).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('rates a validated checksum above a bare label anchor', () => {
    const checksummed = scoreEvidence(evidence({ schemaParsed: true, checksumValid: true }))
    const anchored = scoreEvidence(evidence({ schemaParsed: true, labelAnchored: true }))
    expect(checksummed).toBeGreaterThan(anchored)
  })

  it('drops below the quiet threshold when the two passes disagree', () => {
    // The CA specimen: grounded read 11234568, plain read I1234568. A value
    // the two passes disagree on is exactly the one that must not go quiet.
    const disagreed = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, crossPassAgreed: false,
    }))
    expect(disagreed).toBeLessThan(QUIET_THRESHOLD)
  })

  it('rates agreement above disagreement, all else equal', () => {
    const agreed = scoreEvidence(evidence({ schemaParsed: true, crossPassAgreed: true }))
    const disagreed = scoreEvidence(evidence({ schemaParsed: true, crossPassAgreed: false }))
    expect(agreed).toBeGreaterThan(disagreed)
  })

  it('scores zero when the value never parsed', () => {
    expect(scoreEvidence(evidence({ schemaParsed: false, checksumValid: true }))).toBe(0)
  })

  it('does not punish a signal that does not apply', () => {
    const noChecksum = scoreEvidence(evidence({ schemaParsed: true, labelAnchored: true }))
    const failedChecksum = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, checksumValid: false,
    }))
    expect(noChecksum).toBeGreaterThan(failedChecksum)
  })
})

describe('withCrossPass', () => {
  const candidate = (raw: string): Candidate =>
    ({ key: 'dl_number', raw, evidence: { ...NO_EVIDENCE, schemaParsed: true } })

  it('marks agreement when the plain pass contains the same value', () => {
    const [out] = withCrossPass([candidate('I1234568')], 'DL I1234568 EXP 2029')
    expect(out?.evidence.crossPassAgreed).toBe(true)
  })

  it('marks disagreement when it does not', () => {
    const [out] = withCrossPass([candidate('11234568')], 'DL I1234568 EXP 2029')
    expect(out?.evidence.crossPassAgreed).toBe(false)
  })

  it('leaves the signal unset when there is no plain pass to compare', () => {
    const [out] = withCrossPass([candidate('11234568')], '')
    expect(out?.evidence.crossPassAgreed).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test confidence`
Expected: FAIL — cannot resolve `@/domain/ocr/confidence`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/ocr/confidence.ts
import { normalizeText } from './grounding'
import type { Candidate, Evidence } from './extract/types'

/** At or above this a row goes quiet. Below it, the crop comes out. */
export const QUIET_THRESHOLD = 0.8

/**
 * Weights over observable signals. Nothing here is the model's opinion of
 * itself: the failure that matters — a capital I read as a digit 1 — is a
 * high-probability substitution, so logprobs would rate it certain.
 */
const WEIGHT = {
  labelAnchored: 0.25,
  checksumValid: 0.45,
  crossPassAgreed: 0.25,
  boxPlausible: 0.05,
} as const

const BASE = 0.3

export function scoreEvidence(evidence: Evidence): number {
  // A value its own schema rejects is not a low-confidence value; upstream
  // drops it. Scoring zero here is the belt to that braces.
  if (!evidence.schemaParsed) return 0

  let score = BASE
  if (evidence.labelAnchored) score += WEIGHT.labelAnchored

  for (const signal of ['checksumValid', 'crossPassAgreed', 'boxPlausible'] as const) {
    const value = evidence[signal]
    // null is "does not apply", which must not read as failure.
    if (value === true) score += WEIGHT[signal]
    else if (value === false) score -= WEIGHT[signal]
  }

  return Math.min(1, Math.max(0, Number(score.toFixed(3))))
}

/**
 * Neither prompt mode dominates — measured 2026-08-02, grounded won 34/36
 * overall and lost 7/9 to 8/9 on one card. Disagreement between them is the
 * cheapest signal we have for a misread identifier.
 */
export function withCrossPass(
  candidates: readonly Candidate[],
  plainText: string,
): readonly Candidate[] {
  if (plainText.trim() === '') return candidates
  const haystack = normalizeText(plainText)

  return candidates.map((candidate) => ({
    ...candidate,
    evidence: {
      ...candidate.evidence,
      crossPassAgreed: haystack.includes(normalizeText(candidate.raw)),
    },
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test confidence && pnpm typecheck`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ocr/confidence.ts tests/domain/ocr/confidence.test.ts
git commit -m "feat(ocr): score a reading on evidence, not on the model's self-belief"
```

---

### Task 10: OcrService

Two passes, one seam. The provider is swappable so the Axis B outcome — LM Studio or an `mlx-vlm` sidecar — changes this file and nothing else.

**Files:**
- Create: `src/server/ocr/service.ts`
- Test: `tests/server/ocr/service.test.ts`

**Interfaces:**
- Consumes: `requestOcr`, `GROUNDED_PROMPT`, `PLAIN_PROMPT`, `OcrError` from `@/server/ocr/client`
- Produces: `type OcrProvider = (request: { imageBase64: string; prompt: string }) => Promise<{ text: string; detections: readonly Detection[] }>`; `readDocument(imageBase64: string, provider?: OcrProvider): Promise<DocumentRead>`; `type DocumentRead = { text: string; plainText: string; detections: readonly Detection[] }`; `envProvider(): OcrProvider`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/ocr/service.test.ts
import { describe, expect, it, vi } from 'vitest'
import { readDocument } from '@/server/ocr/service'

describe('readDocument', () => {
  it('runs both prompt modes and returns both texts', async () => {
    const provider = vi.fn(async ({ prompt }: { prompt: string }) => ({
      text: prompt.includes('grounding') ? 'GROUNDED' : 'PLAIN',
      detections: [],
    }))

    const read = await readDocument('base64', provider)
    expect(read.text).toBe('GROUNDED')
    expect(read.plainText).toBe('PLAIN')
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('still returns the grounded read when the plain pass fails', async () => {
    // Cross-pass agreement is a bonus signal. Losing it must not lose the read.
    const provider = vi.fn(async ({ prompt }: { prompt: string }) => {
      if (!prompt.includes('grounding')) throw new Error('plain pass died')
      return { text: 'GROUNDED', detections: [] }
    })

    const read = await readDocument('base64', provider)
    expect(read.text).toBe('GROUNDED')
    expect(read.plainText).toBe('')
  })

  it('propagates a failed grounded pass', async () => {
    const provider = vi.fn(async () => { throw new Error('server down') })
    await expect(readDocument('base64', provider)).rejects.toThrow('server down')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test service`
Expected: FAIL — cannot resolve `@/server/ocr/service`.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/ocr/service.ts
import { GROUNDED_PROMPT, PLAIN_PROMPT, requestOcr } from './client'
import type { Detection } from '@/domain/ocr/grounding'

export type OcrProvider = (request: {
  readonly imageBase64: string
  readonly prompt: string
}) => Promise<{ readonly text: string; readonly detections: readonly Detection[] }>

export type DocumentRead = {
  readonly text: string
  readonly plainText: string
  readonly detections: readonly Detection[]
}

/** No defaults: a wrong endpoint that silently works is worse than a throw. */
export function envProvider(): OcrProvider {
  const endpoint = process.env.OCR_ENDPOINT
  const model = process.env.OCR_MODEL
  if (!endpoint || !model) {
    throw new Error('OCR_ENDPOINT and OCR_MODEL must both be set')
  }
  return ({ imageBase64, prompt }) => requestOcr({ endpoint, model, imageBase64, prompt })
}

export async function readDocument(
  imageBase64: string,
  provider: OcrProvider = envProvider(),
): Promise<DocumentRead> {
  const grounded = await provider({ imageBase64, prompt: GROUNDED_PROMPT })

  // The plain pass only feeds cross-pass agreement. It is allowed to fail.
  let plainText = ''
  try {
    plainText = (await provider({ imageBase64, prompt: PLAIN_PROMPT })).text
  } catch {
    plainText = ''
  }

  return { text: grounded.text, plainText, detections: grounded.detections }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test service && pnpm typecheck`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/ocr/service.ts tests/server/ocr/service.test.ts
git commit -m "feat(ocr): read a document twice, because neither mode is a superset"
```

---

### Task 11: Document service and upload route

Where the pipeline is assembled. The image is held for the request and discarded.

**Files:**
- Create: `src/server/document-service.ts`
- Create: `src/app/api/application/[id]/documents/route.ts`
- Test: `tests/server/document-service.test.ts`

**Interfaces:**
- Consumes: `readDocument`, `OcrProvider`; `extractFor`, `parseCandidates`; `withCrossPass`, `scoreEvidence`; `bandForWidth`, `demoteForCardExtent`; `toPixels`, `FIT_MODEL`; `applyAction`, `Result`, `failure`
- Produces: `ingestDocument(input: IngestInput): Promise<Result<IngestOutcome>>`; `type IngestInput = { applicationId: string; docType: DocType; imageBase64: string; imageSize: ImageSize; at: string; provider?: OcrProvider }`; `type IngestOutcome = { band: QualityBand; filled: readonly RequirementKey[]; state: ApplicationState }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/document-service.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { ingestDocument } from '@/server/document-service'
import { createApplication } from '@/server/application-service'
import { __resetStoreForTests } from '@/server/store'
import '@/domain/ocr/extract/aamva'

const CARD = [
  '<|ref|>4dLIC#WDLJK00580GF<|/ref|><|det|>[[100,200,400,230]]<|/det|>',
  '<|ref|>3DOB04/17/1982<|/ref|><|det|>[[100,300,400,330]]<|/det|>',
].join('')

const provider = async ({ prompt }: { prompt: string }) => ({
  text: prompt.includes('grounding') ? CARD : 'WDLJK00580GF 04/17/1982',
  detections: prompt.includes('grounding')
    ? [
        { text: '4dLIC#WDLJK00580GF', box: [100, 200, 400, 230] as const },
        { text: '3DOB04/17/1982', box: [100, 300, 400, 330] as const },
      ]
    : [],
})

describe('ingestDocument', () => {
  beforeEach(() => { __resetStoreForTests() })

  it('fills fields from a full-resolution card and marks them derived', async () => {
    const app = createApplication()
    const result = await ingestDocument({
      applicationId: app.id, docType: 'drivers_license',
      imageBase64: 'x', imageSize: { width: 1600, height: 1000 },
      at: '2026-08-02T00:00:00.000Z', provider,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.filled).toContain('dl_number')
    expect(result.value.state.fields.dl_number?.status).toBe('derived')
    expect(result.value.state.fields.dl_number?.provenance?.source).toBe('ocr')
  })

  it('records a box in original-image pixels when the band allows crops', async () => {
    const app = createApplication()
    const result = await ingestDocument({
      applicationId: app.id, docType: 'drivers_license',
      imageBase64: 'x', imageSize: { width: 1600, height: 1000 },
      at: '2026-08-02T00:00:00.000Z', provider,
    })
    if (!result.ok) return
    const box = result.value.state.fields.dl_number?.provenance?.box
    expect(box).toBeDefined()
    expect(box?.[2]).toBeGreaterThan(box?.[0] ?? 0)
  })

  it('suppresses boxes in the text-only band but still fills the fields', async () => {
    const app = createApplication()
    const result = await ingestDocument({
      applicationId: app.id, docType: 'drivers_license',
      imageBase64: 'x', imageSize: { width: 600, height: 380 },
      at: '2026-08-02T00:00:00.000Z', provider,
    })
    if (!result.ok) return
    expect(result.value.band).toBe('text-only')
    expect(result.value.filled).toContain('dl_number')
    expect(result.value.state.fields.dl_number?.provenance?.box).toBeUndefined()
  })

  it('refuses to call OCR below the read floor', async () => {
    let called = false
    const app = createApplication()
    const result = await ingestDocument({
      applicationId: app.id, docType: 'drivers_license',
      imageBase64: 'x', imageSize: { width: 320, height: 200 },
      at: '2026-08-02T00:00:00.000Z',
      provider: async () => { called = true; return { text: '', detections: [] } },
    })

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
  })

  it('attaches a confidence to every field it fills', async () => {
    const app = createApplication()
    const result = await ingestDocument({
      applicationId: app.id, docType: 'drivers_license',
      imageBase64: 'x', imageSize: { width: 1600, height: 1000 },
      at: '2026-08-02T00:00:00.000Z', provider,
    })
    if (!result.ok) return
    const confidence = result.value.state.fields.dl_number?.provenance?.confidence
    expect(confidence).toBeGreaterThan(0)
    expect(confidence).toBeLessThanOrEqual(1)
  })

  it('fills nothing and fails nothing when the read yields no fields', async () => {
    const app = createApplication()
    const result = await ingestDocument({
      applicationId: app.id, docType: 'drivers_license',
      imageBase64: 'x', imageSize: { width: 1600, height: 1000 },
      at: '2026-08-02T00:00:00.000Z',
      provider: async () => ({ text: 'NOTHING USEFUL', detections: [] }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.filled).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test document-service`
Expected: FAIL — cannot resolve `@/server/document-service`.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/document-service.ts
import { randomUUID } from 'node:crypto'
import { scoreEvidence, withCrossPass } from '@/domain/ocr/confidence'
import { extractFor, parseCandidates } from '@/domain/ocr/extract'
import { FIT_MODEL, toPixels, type ImageSize } from '@/domain/ocr/geometry'
import { bandForWidth, demoteForCardExtent, type QualityBand } from '@/domain/ocr/quality'
import { applyAction, getApplication, type Result } from './application-service'
import { failure } from './http'
import { readDocument, type OcrProvider } from './ocr/service'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import type { RequirementKey } from '@/domain/requirements/key'

export type IngestInput = {
  readonly applicationId: string
  readonly docType: DocType
  readonly imageBase64: string
  readonly imageSize: ImageSize
  readonly at: string
  readonly provider?: OcrProvider
}

export type IngestOutcome = {
  readonly band: QualityBand
  readonly filled: readonly RequirementKey[]
  readonly state: ApplicationState
}

export async function ingestDocument(
  input: IngestInput,
): Promise<Result<IngestOutcome>> {
  const preflight = bandForWidth(input.imageSize.width)
  if (preflight === 're-take') {
    return {
      ok: false,
      failure: failure(
        'rejected',
        'That photo is too small to read. Take another with the document filling the frame.',
      ),
    }
  }

  const read = input.provider
    ? await readDocument(input.imageBase64, input.provider)
    : await readDocument(input.imageBase64)

  const band = demoteForCardExtent(preflight, read.detections, input.imageSize.width)
  const documentId = randomUUID()

  const candidates = withCrossPass(
    parseCandidates(extractFor(input.docType, read.detections, read.text)),
    read.plainText,
  )

  const filled: RequirementKey[] = []
  let state: ApplicationState | null = null

  for (const candidate of candidates) {
    const pixels = band === 'full' && candidate.box
      ? toPixels(candidate.box, input.imageSize, FIT_MODEL)
      : null

    const result = applyAction(input.applicationId, {
      type: 'SET_VALUE',
      fieldId: candidate.key,
      value: candidate.raw,
      source: 'ocr',
      at: input.at,
      documentId,
      confidence: scoreEvidence(candidate.evidence),
      ...(pixels && {
        box: [pixels.x, pixels.y, pixels.x + pixels.width, pixels.y + pixels.height] as const,
      }),
    })

    // One field the engine does not want must not sink the other eleven.
    if (!result.ok) continue
    state = result.value
    filled.push(candidate.key)
  }

  // Reading nothing is a normal outcome, not a failure — the fields get asked
  // for as they are today. Fetch rather than mutate: a no-op action would put
  // an event in the audit log saying something happened.
  if (state === null) {
    const current = getApplication(input.applicationId)
    if (!current.ok) return current
    state = current.value
  }

  return { ok: true, value: { band, filled, state } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test document-service && pnpm typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the route**

```ts
// src/app/api/application/[id]/documents/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ingestDocument } from '@/server/document-service'
import { failure, jsonError } from '@/server/http'

type Context = { params: Promise<{ id: string }> }

const bodySchema = z
  .object({
    docType: z.enum([
      'drivers_license', 'state_id', 'passport',
      'dealer_license', 'proof_of_residency',
    ]),
    imageBase64: z.string().min(1),
    imageSize: z.object({ width: z.number().positive(), height: z.number().positive() }),
  })
  .strict()

export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError(failure('malformed', 'Request body must be valid JSON'))
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(failure('malformed', 'Malformed document upload'))
  }

  // The image is never written anywhere. It lives for this call.
  const result = await ingestDocument({
    applicationId: id,
    docType: parsed.data.docType,
    imageBase64: parsed.data.imageBase64,
    imageSize: parsed.data.imageSize,
    at: new Date().toISOString(),
  })

  return result.ok ? NextResponse.json(result.value) : jsonError(result.failure)
}
```

- [ ] **Step 6: Assert nothing persists the image**

```ts
// tests/server/document-service.test.ts — append
import { getAuditLog } from '@/server/audit'

it('never writes the image anywhere it can be read back', async () => {
  const app = createApplication()
  const result = await ingestDocument({
    applicationId: app.id, docType: 'drivers_license',
    imageBase64: 'SECRET-IMAGE-BYTES', imageSize: { width: 1600, height: 1000 },
    at: '2026-08-02T00:00:00.000Z', provider,
  })
  if (!result.ok) return

  expect(JSON.stringify(result.value.state)).not.toContain('SECRET-IMAGE-BYTES')
  // The audit log is append-only and outlives the request. Document bytes in
  // it would be the one copy nobody remembers to delete.
  expect(JSON.stringify(getAuditLog().entries())).not.toContain('SECRET-IMAGE-BYTES')
})
```

Check `getAuditLog().entries()` against the real signature in `src/server/audit.ts` before
running — Task 7 of Phase 1 changed it to hand out copies rather than live refs, and the
accessor name is what that task left behind.

- [ ] **Step 7: Run and commit**

```bash
pnpm test && pnpm typecheck && pnpm build
git add src/server/document-service.ts src/app/api/application tests/server/document-service.test.ts
git commit -m "feat(ocr): assemble the pipeline, and keep the image out of the record"
```

---

### Task 12: Crop and provenance display

The inline crop is the primary treatment on every viewport. When there is no box, the row loses the crop and nothing else.

**Files:**
- Create: `src/ui/panel/DocumentCrop.tsx`
- Modify: `src/ui/panel/Provenance.tsx`
- Modify: `src/ui/panel/FieldRow.tsx:112`
- Test: `tests/ui/panel/DocumentCrop.test.tsx`, `tests/ui/panel/Provenance.test.tsx`

**Interfaces:**
- Consumes: `Provenance` type from `@/domain/application/state`; `QUIET_THRESHOLD` from `@/domain/ocr/confidence`
- Produces: `DocumentCrop({ imageUrl, box, imageSize, alt })`; `Provenance({ provenance, imageUrl, imageSize })`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/panel/DocumentCrop.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentCrop } from '@/ui/panel/DocumentCrop'

describe('DocumentCrop', () => {
  it('renders the region of the document the value came from', () => {
    render(
      <DocumentCrop
        imageUrl="blob:doc"
        box={[100, 200, 400, 260]}
        imageSize={{ width: 1600, height: 1000 }}
        alt="The part of your license this was read from"
      />,
    )
    expect(screen.getByRole('img', {
      name: 'The part of your license this was read from',
    })).toBeInTheDocument()
  })

  it('renders nothing without an image to crop', () => {
    const { container } = render(
      <DocumentCrop
        imageUrl={undefined}
        box={[100, 200, 400, 260]}
        imageSize={{ width: 1600, height: 1000 }}
        alt="x"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a zero-area box', () => {
    const { container } = render(
      <DocumentCrop
        imageUrl="blob:doc" box={[100, 200, 100, 200]}
        imageSize={{ width: 1600, height: 1000 }} alt="x"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
```

```tsx
// tests/ui/panel/Provenance.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Provenance } from '@/ui/panel/Provenance'

describe('Provenance', () => {
  it('says a value was read and invites a check', () => {
    render(<Provenance provenance={{ source: 'ocr', confidence: 0.95 }} />)
    expect(screen.getByText(/from your document/i)).toBeInTheDocument()
  })

  it('says plainly when a reading was unsure', () => {
    render(<Provenance provenance={{ source: 'ocr', confidence: 0.4 }} />)
    // Never a threshold or a percentage: "the photo was hard to read", not
    // OCR_CONFIDENCE_BELOW_THRESHOLD.
    expect(screen.getByText(/hard to read/i)).toBeInTheDocument()
    expect(screen.queryByText(/0\.4|40%|threshold/i)).toBeNull()
  })

  it('shows the crop when a box and an image are both available', () => {
    render(
      <Provenance
        provenance={{ source: 'ocr', confidence: 0.5, box: [10, 20, 100, 60] }}
        imageUrl="blob:doc"
        imageSize={{ width: 800, height: 500 }}
      />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('degrades to text alone when the box is absent', () => {
    render(<Provenance provenance={{ source: 'ocr', confidence: 0.5 }} imageUrl="blob:doc" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/from your document/i)).toBeInTheDocument()
  })

  it('degrades to text alone when the image is gone after a reload', () => {
    render(
      <Provenance provenance={{ source: 'ocr', confidence: 0.5, box: [10, 20, 100, 60] }} />,
    )
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('still describes a carried value as a guess to check', () => {
    render(<Provenance provenance={{ source: 'carried', fromFieldId: 'addr_line1' }} />)
    expect(screen.getByText(/check it belongs here/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test DocumentCrop Provenance`
Expected: FAIL — `DocumentCrop` does not exist; `Provenance` takes no `imageUrl`.

- [ ] **Step 3: Write DocumentCrop**

```tsx
// src/ui/panel/DocumentCrop.tsx
import type { ImageSize } from '@/domain/ocr/geometry'

type Props = {
  imageUrl: string | undefined
  box: readonly [number, number, number, number]
  imageSize: ImageSize | undefined
  alt: string
}

const DISPLAY_WIDTH = 260

/**
 * Clips the original in the browser rather than cutting a crop server-side —
 * the image is never uploaded anywhere it could be stored.
 */
export function DocumentCrop({ imageUrl, box, imageSize, alt }: Props) {
  if (!imageUrl || !imageSize) return null

  const [x0, y0, x1, y1] = box
  const width = x1 - x0
  const height = y1 - y0
  if (width <= 0 || height <= 0) return null

  const scale = Math.min(DISPLAY_WIDTH / width, 3)

  return (
    <div
      role="img"
      aria-label={alt}
      style={{
        width: width * scale, height: height * scale,
        marginTop: 6, overflow: 'hidden', position: 'relative',
      }}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden
        style={{
          position: 'absolute',
          width: imageSize.width * scale, height: imageSize.height * scale,
          left: -x0 * scale, top: -y0 * scale, maxWidth: 'none',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Extend Provenance**

```tsx
// src/ui/panel/Provenance.tsx
import type { Provenance as ProvenanceValue } from '@/domain/application/state'
import { QUIET_THRESHOLD } from '@/domain/ocr/confidence'
import type { ImageSize } from '@/domain/ocr/geometry'
import { COLOR } from '@/ui/theme/tokens'
import { DocumentCrop } from './DocumentCrop'

/**
 * A carried value is a guess, not a fact — a dealer licence may be registered
 * somewhere other than home — so the copy invites a check rather than reading
 * like settled data.
 */
const SOURCE_LABEL: Record<string, string> = {
  ocr: 'from your document',
  carried: 'copied from what you already told us — check it belongs here',
  lookup: 'looked up for you',
  user: 'entered by you',
}

type Props = {
  provenance: ProvenanceValue
  imageUrl?: string
  imageSize?: ImageSize
}

export function Provenance({ provenance, imageUrl, imageSize }: Props) {
  const unsure =
    provenance.source === 'ocr'
    && provenance.confidence !== undefined
    && provenance.confidence < QUIET_THRESHOLD

  const label = SOURCE_LABEL[provenance.source] ?? provenance.source
  // Never a number and never a code: a person reads this, not a log parser.
  const text = unsure ? `${label} — the photo was hard to read here` : label

  return (
    <>
      {provenance.box && (
        <DocumentCrop
          imageUrl={imageUrl}
          box={provenance.box}
          imageSize={imageSize}
          alt="The part of your document this was read from"
        />
      )}
      <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '4px 0 0' }}>
        {text}
      </p>
    </>
  )
}
```

- [ ] **Step 5: Thread the image through FieldRow**

In `src/ui/panel/FieldRow.tsx`, add the import and extend `Props`:

```ts
import type { ImageSize } from '@/domain/ocr/geometry'
```

```ts
  /** The document this row's value was read from, if the browser still holds it. */
  documentUrl?: string
  documentSize?: ImageSize
```

and replace line 112:

```tsx
      {state?.provenance && (
        <Provenance
          provenance={state.provenance}
          {...(props.documentUrl && { imageUrl: props.documentUrl })}
          {...(props.documentSize && { imageSize: props.documentSize })}
        />
      )}
```

`ApplicationPanel.tsx` passes both straight through from its own new optional props of the same names.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS, all suites.

- [ ] **Step 7: Commit**

```bash
git add src/ui/panel tests/ui/panel
git commit -m "feat(panel): show the part of the document a value was read from"
```

---

### Task 13: Upload control and page wiring

The applicant-facing half. The browser keeps the image; the page hands it to the panel for crops.

**Files:**
- Create: `src/ui/panel/DocumentUpload.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/ui/panel/DocumentUpload.test.tsx`

**Interfaces:**
- Consumes: `bandForWidth` from `@/domain/ocr/quality`
- Produces: `DocumentUpload({ docType, onRead, disabled })`; `type ReadResult = { imageUrl: string; imageSize: ImageSize }`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/panel/DocumentUpload.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DocumentUpload } from '@/ui/panel/DocumentUpload'

describe('DocumentUpload', () => {
  it('asks for the document by name, not by file type', () => {
    render(<DocumentUpload docType="drivers_license" onRead={vi.fn()} />)
    expect(screen.getByLabelText(/photo of your driver.s license/i)).toBeInTheDocument()
  })

  it('says what a good photo looks like before one is taken', () => {
    render(<DocumentUpload docType="drivers_license" onRead={vi.fn()} />)
    expect(screen.getByText(/fill the frame/i)).toBeInTheDocument()
  })

  it('asks for another photo when the image is below the read floor', async () => {
    const onRead = vi.fn()
    render(<DocumentUpload docType="drivers_license" onRead={onRead} measure={
      async () => ({ width: 320, height: 200 })
    } />)

    const file = new File(['x'], 'tiny.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText(/photo of your/i), file)

    expect(await screen.findByRole('status')).toHaveTextContent(/too small to read/i)
    expect(onRead).not.toHaveBeenCalled()
  })

  it('accepts a large enough image and hands it up', async () => {
    const onRead = vi.fn()
    render(<DocumentUpload docType="drivers_license" onRead={onRead} measure={
      async () => ({ width: 1600, height: 1000 })
    } />)

    const file = new File(['x'], 'card.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText(/photo of your/i), file)

    expect(onRead).toHaveBeenCalledTimes(1)
  })

  it('warns without blocking in the band that reads but cannot crop', async () => {
    const onRead = vi.fn()
    render(<DocumentUpload docType="drivers_license" onRead={onRead} measure={
      async () => ({ width: 600, height: 380 })
    } />)

    const file = new File(['x'], 'card.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText(/photo of your/i), file)

    expect(onRead).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent(/read it, but/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test DocumentUpload`
Expected: FAIL — cannot resolve `@/ui/panel/DocumentUpload`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/ui/panel/DocumentUpload.tsx
'use client'

import { useState } from 'react'
import { bandForWidth } from '@/domain/ocr/quality'
import type { ImageSize } from '@/domain/ocr/geometry'
import type { DocType } from '@/domain/field-id'
import { COLOR } from '@/ui/theme/tokens'

const DOC_LABEL: Record<DocType, string> = {
  drivers_license: "Photo of your driver's license",
  state_id: 'Photo of your state ID',
  passport: 'Photo of your passport',
  dealer_license: 'Photo of your dealer license',
  proof_of_residency: 'Photo of your proof of address',
}

type Props = {
  docType: DocType
  onRead: (file: File, size: ImageSize, url: string) => void
  disabled?: boolean
  /** Injectable so the size check is testable without a real decoder. */
  measure?: (file: File) => Promise<ImageSize>
}

async function measureImage(file: File): Promise<ImageSize> {
  const bitmap = await createImageBitmap(file)
  return { width: bitmap.width, height: bitmap.height }
}

export function DocumentUpload({ docType, onRead, disabled, measure }: Props) {
  const [notice, setNotice] = useState<string | null>(null)
  const inputId = `upload-${docType}`

  const handle = async (file: File | undefined) => {
    if (!file) return
    const size = await (measure ?? measureImage)(file)

    if (bandForWidth(size.width) === 're-take') {
      setNotice(
        'That photo is too small to read. Take another with the document filling the frame.',
      )
      return
    }

    setNotice(
      bandForWidth(size.width) === 'text-only'
        ? 'We read it, but the photo is too small to show you where each answer came from.'
        : null,
    )
    onRead(file, size, URL.createObjectURL(file))
  }

  return (
    <div style={{ margin: '12px 0' }}>
      <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
        {DOC_LABEL[docType]}
      </label>
      <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '2px 0 6px' }}>
        Lay it flat and fill the frame. We read what we can and ask you about the rest.
      </p>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        disabled={disabled ?? false}
        onChange={(e) => { void handle(e.target.files?.[0]) }}
      />
      {notice && (
        <p role="status" style={{ fontSize: 12, marginTop: 6, color: COLOR.textPrimary }}>
          {notice}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test DocumentUpload && pnpm typecheck`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the page**

In `src/app/page.tsx`, hold the uploaded document alongside the application state and post it:

```tsx
const [document, setDocument] = useState<
  { url: string; size: ImageSize } | null
>(null)

/** The route takes a base64 payload with no `data:` prefix, as the client does. */
const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })

const readDocument = async (file: File, size: ImageSize, url: string) => {
  setDocument({ url, size })
  const imageBase64 = await toBase64(file)
  const response = await fetch(`/api/application/${state.id}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docType: 'drivers_license', imageBase64, imageSize: size }),
  })
  if (!response.ok) return
  const outcome = await response.json()
  setState(outcome.state)
}
```

Render `<DocumentUpload docType="drivers_license" onRead={readDocument} disabled={closed} />`
above `<ApplicationPanel />`, and pass `documentUrl={document?.url}` and
`documentSize={document?.size}` into the panel.

The demo page uses the in-process reducer for every other action, so `state.id` is
`'demo'`. Change `createApplication('demo', initialProfile)` to use the id the API
returns, or the upload will 404 — create the application through `POST /api/application`
on mount and seed state from the response.

- [ ] **Step 6: Verify in the browser**

Run: `pnpm dev`. Upload a specimen from `sample/licenses/specimens/`. Confirm: fields fill as dashed `derived` rows, each showing a crop and "from your document", and each still requiring "Looks right".

- [ ] **Step 7: Commit**

```bash
git add src/ui/panel/DocumentUpload.tsx src/app/page.tsx tests/ui/panel/DocumentUpload.test.tsx
git commit -m "feat(panel): let an applicant hand us the document instead of the answers"
```

---

### Task 14: Ownership check

`src/server/application-service.ts:33` carries a `TODO(phase-2)`: knowing an application id is enough to read every value in it, including `tax_id` and `dob`. This phase adds an endpoint that accepts identity documents, so the gap is worth closing now.

**Files:**
- Modify: `src/server/application-service.ts`, `src/server/document-service.ts`, `src/server/http.ts`
- Modify: `src/domain/application/state.ts`, `src/domain/application/reducer.ts`
- Modify: `src/app/api/application/route.ts`, `.../[id]/route.ts`, `.../[id]/actions/route.ts`, `.../[id]/documents/route.ts`
- Modify: `src/app/page.tsx` and every suite calling `createApplication`
- Test: `tests/integration/route-handlers.test.ts`

**Interfaces:**
- Produces: `ApplicationState.ownerToken: string`; `getApplication(id: string, token: string | null): Result<ApplicationState>`; `applyAction(id: string, action: Action, token: string | null): Result<ApplicationState>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/route-handlers.test.ts — append
describe('ownership', () => {
  it('refuses a read without the owner token', async () => {
    const created = await postJson('/api/application', {})
    const response = await getJson(`/api/application/${created.id}`, { token: null })
    expect(response.status).toBe(404)
  })

  it('refuses a read with the wrong token', async () => {
    const created = await postJson('/api/application', {})
    const response = await getJson(`/api/application/${created.id}`, { token: 'guessed' })
    expect(response.status).toBe(404)
  })

  it('allows a read with the token issued at creation', async () => {
    const created = await postJson('/api/application', {})
    const response = await getJson(`/api/application/${created.id}`, {
      token: created.ownerToken,
    })
    expect(response.status).toBe(200)
  })

  it('never returns the owner token when reading an application back', async () => {
    const created = await postJson('/api/application', {})
    const body = await (await getJson(
      `/api/application/${created.id}`, { token: created.ownerToken },
    )).json()
    expect(body.ownerToken).toBeUndefined()
  })

  it('refuses a document upload without the token', async () => {
    const created = await postJson('/api/application', {})
    const response = await postJson(
      `/api/application/${created.id}/documents`,
      { docType: 'drivers_license', imageBase64: 'x', imageSize: { width: 1600, height: 1000 } },
      { token: null },
    )
    expect(response.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test route-handlers`
Expected: FAIL — reads succeed without a token.

- [ ] **Step 3: Implement**

```ts
// src/domain/application/state.ts — add to ApplicationState
  /** Issued once at creation. Knowing an id must not be enough to read a record. */
  ownerToken: string
```

```ts
// src/domain/application/reducer.ts — the token is passed in, never generated here
export function createApplication(
  id: string,
  profile: ApplicantProfile,
  ownerToken: string,
): ApplicationState {
  return { id, ownerToken, rulesVersion: RULES_VERSION, profile, fields: {}, submittedAt: null }
}
```

```ts
// src/server/application-service.ts
export function createApplication(): ApplicationState {
  const created = newApplication(randomUUID(), STARTING_PROFILE, randomUUID())
  putApplication(created)
  return created
}

/**
 * A wrong token answers "unknown", never "forbidden". Confirming that an id
 * exists is the same leak wearing a smaller hat.
 */
function owned(
  state: ApplicationState | undefined,
  token: string | null,
): Result<ApplicationState> {
  if (!state || token === null || token !== state.ownerToken) {
    return { ok: false, failure: failure('unknown', 'unknown application') }
  }
  return { ok: true, value: state }
}

export function getApplication(id: string, token: string | null): Result<ApplicationState> {
  return owned(loadApplication(id), token)
}
```

`applyAction(id, action, token)` takes the same third argument and calls `owned` before
anything else. `ingestDocument` gains an `ownerToken` field on `IngestInput` and threads
it into both calls.

```ts
// every route handler except POST /api/application
const token = request.headers.get('x-owner-token')
```

```ts
// src/app/api/application/route.ts — the creation response, and only this one
const created = createApplication()
return NextResponse.json(created)   // carries ownerToken exactly once
```

```ts
// src/server/http.ts — new helper, used by every other response
/** The token is issued once. Echoing it back widens where it can leak from. */
export function withoutToken(state: ApplicationState) {
  const { ownerToken: _ownerToken, ...rest } = state
  return rest
}
```

The reducer takes the token rather than minting one — `randomUUID()` in `src/domain/`
would break the purity test. Adding a third parameter breaks every existing caller:
`src/app/page.tsx:24` and the application, carry and integration test suites. Fix them by
passing a literal (`'test-token'`), not by making the parameter optional — an optional
owner token is an owner token somebody forgets.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add src/server src/domain/application/state.ts src/app/api tests/integration
git commit -m "fix(api): stop an application id from being a password"
```

---

## Closeout

- [ ] **Full verification**

```bash
pnpm test && pnpm typecheck && pnpm build
```

- [ ] **Degraded end-to-end check**

With `OCR_ENDPOINT` unset, complete a registration through the panel by hand. Nothing may
mention OCR, and no error state may appear. This is the check that proves the phase is
additive.

- [ ] **Update the ledger**

Record the outcome in the SDD progress file, including the labelled-recall number and the
fit-model verdict, and note whether Axis B is still open.
