import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { requestOcr, GROUNDED_PROMPT, PLAIN_PROMPT } from '@/server/ocr/client'
import type { Box } from '@/domain/ocr/grounding'
import { scoreField, summarise, type ExpectedValue } from './score'

/**
 * The OCR acceptance gate run. Skipped unless both env vars are set, so the normal
 * suite stays green offline. See `.env.local.example`.
 *
 *   OCR_ENDPOINT=http://<host>:<port> OCR_MODEL=<id> pnpm vitest run tools/ocr-gate
 */

const ENDPOINT = process.env.OCR_ENDPOINT
const MODEL = process.env.OCR_MODEL
const SAMPLES = join(process.cwd(), 'sample', 'licenses')

type SpecimenTruth = {
  image: string
  state: string
  px: [number, number]
  fields: Record<string, ExpectedValue>
  labels?: Record<string, string>
  dl_number_box: Box
}

type SyntheticTruth = {
  image: string
  dpi: number
  px: [number, number]
  fields: Record<string, { value: string; printed_pt: number; box: Box }>
}

const readJson = <T,>(...path: string[]): T =>
  JSON.parse(readFileSync(join(SAMPLES, ...path), 'utf8')) as T

const imageBase64 = (dir: string, name: string) =>
  readFileSync(join(SAMPLES, dir, name)).toString('base64')

const run = (dir: string, image: string, prompt: string) =>
  requestOcr({
    endpoint: ENDPOINT!, model: MODEL!, imageBase64: imageBase64(dir, image), prompt,
  })

describe.skipIf(!ENDPOINT || !MODEL)('OCR acceptance gate', () => {
  const report: unknown[] = []

  it('reads the synthetic resolution sweep', async () => {
    const truth = readJson<SyntheticTruth[]>('synthetic', 'ground_truth.json')

    for (const card of truth) {
      const result = await run('synthetic', card.image, GROUNDED_PROMPT)
      const scores = Object.entries(card.fields).map(([, f]) =>
        scoreField(f.value, result.text, result.detections, { trueBox: f.box }),
      )
      const summary = summarise(scores)
      report.push({ image: card.image, dpi: card.dpi, px: card.px, ...summary })

      console.log(
        `${card.image.padEnd(16)} ${String(card.px[0] + 'px').padStart(7)} ` +
        `read ${summary.read}/${summary.fields}  IoU>=.5 ${summary.localised}/${summary.boxed}`,
      )
      expect(result.detections.length).toBeGreaterThan(0)
    }
  }, 600_000)

  it('reads the specimen cards, grounded beating plain overall', async () => {
    const { specimens } = readJson<{ specimens: SpecimenTruth[] }>(
      'specimens', 'ground_truth.json',
    )
    const totals = { grounded: 0, plain: 0, fields: 0 }

    for (const card of specimens) {
      const grounded = await run('specimens', card.image, GROUNDED_PROMPT)
      const plain = await run('specimens', card.image, PLAIN_PROMPT)

      const score = (text: string, dets: typeof grounded.detections) =>
        Object.entries(card.fields).map(([id, expected]) =>
          scoreField(expected, text, dets, {
            ...(card.labels?.[id] ? { label: card.labels[id]! } : {}),
            ...(id === 'dl_number' ? { trueBox: card.dl_number_box } : {}),
          }),
        )

      const g = summarise(score(grounded.text, grounded.detections))
      const p = summarise(score(plain.text, plain.detections))
      report.push({ image: card.image, state: card.state, grounded: g, plain: p })

      console.log(
        `${card.state.padEnd(3)} ${card.image.padEnd(18)} ` +
        `grounded ${g.read}/${g.fields}  plain ${p.read}/${p.fields}` +
        (p.read > g.read ? '   <-- plain won' : ''),
      )

      totals.grounded += g.read
      totals.plain += p.read
      totals.fields += g.fields
    }

    // Grounded wins on aggregate but NOT on every card — plain recovers the CA
    // ZIP that grounded drops. Neither mode dominates; see the gate report.
    expect(totals.grounded).toBeGreaterThan(totals.plain)

    writeFileSync(
      join(process.cwd(), 'tools', 'ocr-gate', 'results.json'),
      JSON.stringify(report, null, 2),
    )
  }, 600_000)
})
