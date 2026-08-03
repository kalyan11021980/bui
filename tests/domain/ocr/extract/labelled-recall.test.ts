import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractLabelled } from '@/domain/ocr/extract/labelled'
import { parseCandidates } from '@/domain/ocr/extract'
import { CATALOG } from '@/domain/catalog'
import type { Detection } from '@/domain/ocr/grounding'

/**
 * Recall against the recorded fixtures, graded against the images themselves
 * — the dealer licence's rendered PNG, checked by eye against
 * `synthetic/dealer_license_truth.json` and against `synonyms.ts`, never
 * against the recorded OCR `text`. Grading an extractor against OCR output
 * measures parsing, not reading.
 */

type Fixture = {
  slug: string
  docType: 'dealer_license' | 'proof_of_residency'
  detections: Detection[]
  text: string
}

const docs: Fixture[] = readdirSync('sample/licenses/fixtures')
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    slug: f.replace(/\.json$/, ''),
    ...(JSON.parse(readFileSync(`sample/licenses/fixtures/${f}`, 'utf8')) as Omit<Fixture, 'slug'>),
  }))
  .filter((f) => f.docType === 'dealer_license' || f.docType === 'proof_of_residency')

/**
 * Locked as key AND value, so a change to what the strategy reads — or a
 * change to which value it attaches to a key it already read — has to be
 * argued for in a diff rather than silently drifting a console.log nobody
 * reads. A key-only lock would pass a candidate that kept its field but
 * swapped in a neighbouring label's value; that failure mode is exactly what
 * a box-adjacency search over several nearby detections can produce.
 *
 * Values verified by eye against the rendered image (dealer licence) and
 * against the fixture's own detections (utility bill, bank statement) — see
 * `docs/superpowers/decisions/2026-08-02-labelled-recall.md`.
 */
const EXPECTED: Record<string, Readonly<Record<string, string>>> = {
  dealer_license: {
    'license_number#0': 'DLR-0000-4471',
    'license_effective#0': '2025-03-01',
    'license_expiry#0': '2027-02-28',
    biz_legal_name: 'SPECIMEN AUTO SALES LLC',
  },
  chicago_utility_bill: {},
  bank_statement: {},
}

describe('labelled recall', () => {
  it('has the corpus it thinks it has', () => {
    // Guards every test below: a filter matching nothing would pass them all.
    expect(docs.filter((d) => d.docType === 'dealer_license')).toHaveLength(1)
    expect(docs.filter((d) => d.docType === 'proof_of_residency')).toHaveLength(2)
    expect(docs.map((d) => d.slug).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it('records what it managed to read, without pretending it read more', () => {
    for (const doc of docs) {
      const out = parseCandidates(extractLabelled(doc.detections, doc.text))
      console.log(`${doc.docType} (${doc.slug}): ${out.length} fields — ${out.map((c) => c.key).join(', ')}`)

      const want = EXPECTED[doc.slug]
      expect(want, doc.slug).toBeDefined()
      const got = Object.fromEntries(out.map((c) => [c.key, c.raw]))
      expect(got, doc.slug).toEqual(want ?? {})
    }
  })

  it('reads a licence number from every dealer licence in the corpus', () => {
    // The floor the strategy has to clear. A dealer licence prints its number
    // beside the word "License" — failing this is a broken strategy, not a
    // weak one. Proof-of-residency documents get no floor: what a utility
    // bill yields is the open question this task exists to answer.
    const dealers = docs.filter((d) => d.docType === 'dealer_license')
    expect(dealers.length).toBeGreaterThan(0)

    for (const doc of dealers) {
      const keys = parseCandidates(extractLabelled(doc.detections, doc.text)).map((c) => c.key)
      expect(keys).toContain('license_number#0')
    }
  })

  it('reads nothing off either proof-of-residency document', () => {
    // Not a strategy bug: a utility bill prints "Utility Service Address" and
    // a bank statement prints "Account No." — neither is a synonym this table
    // knows, and neither document says "License Number" or "Effective Date".
    const residency = docs.filter((d) => d.docType === 'proof_of_residency')
    expect(residency.length).toBe(2)
    for (const doc of residency) {
      expect(parseCandidates(extractLabelled(doc.detections, doc.text))).toEqual([])
    }
  })

  it('finds no text field the catalog lets a proof-of-residency document answer', () => {
    // The real ceiling, independent of the strategy. Even a perfect reader
    // could not carry a value out of a utility bill or bank statement: the
    // only catalog entry naming `proof_of_residency` in `derivableFrom` is
    // the upload field itself, a `file` type — `extractFor` would drop any
    // text candidate a strategy produced. This is a catalog decision, not a
    // strategy one; see the decision record.
    const derivable = [...CATALOG.values()].filter(
      (f) => f.derivableFrom?.includes('proof_of_residency'),
    )
    expect(derivable.map((f) => f.id)).toEqual(['proof_of_residency'])
    expect(derivable[0]?.type).toBe('file')
  })
})
