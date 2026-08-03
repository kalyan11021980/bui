import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { requestOcr, GROUNDED_PROMPT } from '@/server/ocr/client'
import { findValue, intersectionOverUnion, type Box } from '@/domain/ocr/grounding'
import { toPixels, type FitModel, type ImageSize } from '@/domain/ocr/geometry'

/**
 * Settles whether the server stretches or letterboxes an image to a square,
 * by reading markers printed at known pixel positions and scoring both
 * mappings. Skipped unless a server is configured, so `pnpm test` stays offline.
 *
 *   OCR_ENDPOINT=http://<host>:<port> OCR_MODEL=<id> pnpm vitest run tools/ocr-gate
 */

const ENDPOINT = process.env.OCR_ENDPOINT
const MODEL = process.env.OCR_MODEL
const CALIB = join(process.cwd(), 'sample', 'licenses', 'calibration')

const FITS: readonly FitModel[] = ['stretch', 'pad']

type Truth = {
  readonly image: string
  readonly size: ImageSize
  readonly markers: Record<string, [number, number, number, number]>
}

const truths: Truth[] = JSON.parse(readFileSync(join(CALIB, 'truth.json'), 'utf8'))

const centre = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]

/** Centre offset in pixels — survives a box-tightness mismatch that sinks IoU. */
function centreDistance(a: Box, b: Box): number {
  const [ax, ay] = centre(a)
  const [bx, by] = centre(b)
  return Math.hypot(ax - bx, ay - by)
}

describe.skipIf(!ENDPOINT || !MODEL)('fit model calibration', () => {
  it('scores both fit models against markers at known positions', async () => {
    const endpoint = ENDPOINT!
    const model = MODEL!

    const observed: Record<string, Record<string, Box>> = {}
    const perImage: Record<string, Record<FitModel, number>> = {}

    for (const truth of truths) {
      const imageBase64 = readFileSync(join(process.cwd(), truth.image)).toString('base64')
      const { detections } = await requestOcr({
        endpoint, model, imageBase64, prompt: GROUNDED_PROMPT,
      })

      // Kept so the geometry test can re-check the mapping without a server.
      observed[truth.image] = {}
      const missing: string[] = []
      for (const marker of Object.keys(truth.markers)) {
        const found = findValue(detections, marker)
        if (found) observed[truth.image]![marker] = found.box
        else missing.push(marker)
      }

      const name = truth.image.split('/').pop()!
      console.log(
        `\n${name}  ${truth.size.width}x${truth.size.height}  ` +
        `read ${Object.keys(observed[truth.image]!).length}/4` +
        (missing.length ? `  not read: ${missing.join(',')}` : ''),
      )

      perImage[truth.image] = { stretch: 0, pad: 0 }
      for (const fit of FITS) {
        const scores: number[] = []
        for (const [text, trueBox] of Object.entries(truth.markers)) {
          const box = observed[truth.image]![text]
          if (!box) continue
          const m = toPixels(box, truth.size, fit)
          const mapped: Box = [m.x, m.y, m.x + m.width, m.y + m.height]
          const iou = intersectionOverUnion(mapped, trueBox)
          scores.push(iou)
          console.log(
            `  ${fit.padEnd(7)} ${text.padEnd(11)} IoU ${iou.toFixed(3)}  ` +
            `centre off ${centreDistance(mapped, trueBox).toFixed(0)}px  ` +
            `mapped [${mapped.map((n) => Math.round(n)).join(',')}] ` +
            `true [${trueBox.join(',')}]`,
          )
        }
        const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
        perImage[truth.image]![fit] = mean
        console.log(`  ${fit.padEnd(7)} MEAN IoU ${mean.toFixed(3)} over ${scores.length}`)
      }
    }

    writeFileSync(join(CALIB, 'observed.json'), JSON.stringify(observed, null, 2) + '\n')

    console.log('\nmean IoU by image')
    for (const [image, means] of Object.entries(perImage)) {
      console.log(
        `  ${image.split('/').pop()!.padEnd(22)} ` +
        FITS.map((f) => `${f} ${means[f].toFixed(3)}`).join('  '),
      )
    }

    // The square is the control: both models are arithmetically identical on it,
    // so a difference here means the harness is wrong, not the server. Assert it
    // is present — a guarded check silently evaporates if the entry is renamed.
    const square = perImage['sample/licenses/calibration/square.png']
    expect(square, 'square control missing from truth.json').toBeDefined()
    expect(square!.pad).toBeCloseTo(square!.stretch, 6)

    expect(Object.keys(observed).length).toBe(truths.length)
  }, 600_000)
})
