import { describe, it, expect } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { requestOcr, GROUNDED_PROMPT, PLAIN_PROMPT } from '@/server/ocr/client'

/**
 * Records one fixture per manifest entry, so no later test needs a server.
 *
 *   OCR_ENDPOINT=http://<host>:<port> OCR_MODEL=<model-id> pnpm vitest run record
 */

const ENDPOINT = process.env.OCR_ENDPOINT
const MODEL = process.env.OCR_MODEL
const ROOT = process.cwd()

type Entry = {
  image: string
  docType: string
  slug: string
  issuer: string
  synthetic?: boolean
  size: { width: number; height: number }
}

// A full-page bill runs far past the 4096 the cards need, and a response cut
// by max_tokens loses its last detections silently.
const MAX_TOKENS = 12_288

describe.skipIf(!ENDPOINT || !MODEL)('fixture recording', () => {
  it('records a grounded and plain read for every specimen in the manifest', async () => {
    const manifest: Entry[] = JSON.parse(
      readFileSync(join(ROOT, 'sample', 'licenses', 'manifest.json'), 'utf8'),
    )
    const out = join(ROOT, 'sample', 'licenses', 'fixtures')
    mkdirSync(out, { recursive: true })

    for (const entry of manifest) {
      const imageBase64 = readFileSync(join(ROOT, entry.image)).toString('base64')
      const run = (prompt: string) =>
        requestOcr({
          endpoint: ENDPOINT!, model: MODEL!, imageBase64, prompt,
          maxTokens: MAX_TOKENS,
        })

      const grounded = await run(GROUNDED_PROMPT)
      const plain = await run(PLAIN_PROMPT)

      writeFileSync(
        join(out, `${entry.slug}.json`),
        JSON.stringify({
          docType: entry.docType,
          issuer: entry.issuer,
          ...(entry.synthetic ? { synthetic: true } : {}),
          image: entry.image,
          imageSize: entry.size,
          text: grounded.text,
          detections: grounded.detections,
          plainText: plain.text,
        }, null, 2) + '\n',
      )

      console.log(
        `${entry.slug.padEnd(22)} ${entry.docType.padEnd(19)} ` +
        `${String(grounded.detections.length).padStart(3)} detections  ` +
        `${String(grounded.completionTokens ?? 0).padStart(5)} tok` +
        (grounded.completionTokens === MAX_TOKENS ? '  <-- TRUNCATED' : ''),
      )

      // A silent empty read would produce a fixture that every later test
      // passes against while proving nothing.
      expect(grounded.detections.length, entry.slug).toBeGreaterThan(0)
      expect(plain.text.trim(), entry.slug).not.toBe('')
      expect(grounded.completionTokens, entry.slug).not.toBe(MAX_TOKENS)
    }
  }, 1_200_000)
})
