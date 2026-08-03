import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DocType } from '@/domain/field-id'

// Guards the recorded corpus that later extraction tests read instead of a server.

type Entry = {
  image: string
  docType: DocType
  slug: string
  issuer: string
  synthetic?: boolean
  size: { width: number; height: number }
}

type Fixture = {
  docType: DocType
  issuer: string
  synthetic?: boolean
  image: string
  imageSize: { width: number; height: number }
  text: string
  detections: { text: string; box: [number, number, number, number] }[]
  plainText: string
}

const manifest: Entry[] = JSON.parse(
  readFileSync('sample/licenses/manifest.json', 'utf8'),
)

const files = readdirSync('sample/licenses/fixtures').filter((f) => f.endsWith('.json'))
const fixtures = new Map<string, Fixture>(
  files.map((f) => [
    f.replace(/\.json$/, ''),
    JSON.parse(readFileSync(`sample/licenses/fixtures/${f}`, 'utf8')) as Fixture,
  ]),
)

const REQUIRED: DocType[] = [
  'drivers_license', 'state_id', 'passport', 'dealer_license', 'proof_of_residency',
]

// PNG width/height are big-endian uint32 in the IHDR chunk, at byte offsets 16 and 20.
function pngDimensions(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('fixture corpus', () => {
  it('has one fixture per manifest entry and no orphans', () => {
    expect([...fixtures.keys()].sort()).toEqual(manifest.map((e) => e.slug).sort())
  })

  it('covers every document type the extractors claim to handle', () => {
    const covered = new Set([...fixtures.values()].map((f) => f.docType))
    for (const docType of REQUIRED) expect([...covered]).toContain(docType)
  })

  it('reads more than one issuer per card type, so a layout quirk cannot pass for a rule', () => {
    const recorded = [...fixtures.values()]
    const issuers = (docType: DocType) =>
      new Set(recorded.filter((f) => f.docType === docType).map((f) => f.issuer))

    expect(issuers('drivers_license').size).toBeGreaterThanOrEqual(4)
    expect(issuers('state_id').size).toBeGreaterThanOrEqual(2)
    expect(issuers('proof_of_residency').size).toBeGreaterThanOrEqual(2)
  })

  it('records a real read for every fixture, not an empty one', () => {
    for (const [slug, f] of fixtures) {
      expect(f.text.trim(), slug).not.toBe('')
      expect(f.plainText.trim(), slug).not.toBe('')
      expect(f.detections.length, slug).toBeGreaterThan(4)
      for (const d of f.detections) {
        expect(d.text, slug).not.toBe('')
        expect(d.box, slug).toHaveLength(4)
      }
    }
  })

  it('agrees with the manifest on size and document type', () => {
    for (const entry of manifest) {
      const f = fixtures.get(entry.slug)!
      expect(f.docType, entry.slug).toBe(entry.docType)
      expect(f.image, entry.slug).toBe(entry.image)
      expect(f.imageSize, entry.slug).toEqual(entry.size)
      expect(entry.size.width, entry.slug).toBeGreaterThan(0)
    }
  })

  it('agrees with the actual PNG dimensions, not just its own claim', () => {
    for (const entry of manifest) {
      expect(pngDimensions(entry.image), entry.slug).toEqual(entry.size)
    }
  })

  it('labels the dealer licence synthetic wherever it appears', () => {
    const entry = manifest.find((e) => e.docType === 'dealer_license')!
    expect(entry.synthetic).toBe(true)
    expect(fixtures.get(entry.slug)!.synthetic).toBe(true)
  })

  it('read a two-line machine-readable zone off the passport', () => {
    const passport = manifest.find((e) => e.docType === 'passport')!
    const mrz = fixtures.get(passport.slug)!.detections
      .map((d) => d.text)
      .filter((t) => t.includes('<<'))

    // The MRZ is the whole reason a passport is in the corpus. Filler-run
    // length is what an extractor keys on; character accuracy is not asserted
    // here, because the recorded read has errors the extractor must survive.
    expect(mrz.length).toBe(2)
    for (const line of mrz) expect(line.length).toBeGreaterThan(35)
  })
})
