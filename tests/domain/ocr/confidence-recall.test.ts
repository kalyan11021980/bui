import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '@/domain/ocr/extract/aamva'
import '@/domain/ocr/extract/mrz'
import '@/domain/ocr/extract/labelled'
import { extractFor, parseCandidates } from '@/domain/ocr/extract'
import { respaceAddresses } from '@/domain/ocr/extract/aamva'
import { QUIET_THRESHOLD, scoreEvidence, withCrossPass } from '@/domain/ocr/confidence'
import type { DocType } from '@/domain/field-id'
import type { Detection } from '@/domain/ocr/grounding'

/**
 * The regression this whole module exists to prevent: a value that reads
 * wrong against ground truth scoring at or above QUIET_THRESHOLD, which
 * would surface it as a quiet row instead of a crop. Graded on hand-
 * transcribed truth, never on the recorded OCR text — see aamva-recall.test.ts.
 */

type Fixture = {
  docType: DocType
  image: string
  detections: Detection[]
  text: string
  plainText: string
}

type Truth = { image: string; fields: Record<string, string | string[]> }

const slug = (path: string): string => path.split('/').pop() ?? path
const flat = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Ground truth stores dates as printed (MM/DD/YYYY) or already ISO (MRZ). */
const iso = (printed: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(printed)) return printed
  const [month, day, year] = printed.split(/[/-]/)
  return `${year}-${month}-${day}`
}

const files = readdirSync('sample/licenses/fixtures').filter((f) => f.endsWith('.json'))
const fixtures: Fixture[] = files.map(
  (f) => JSON.parse(readFileSync(`sample/licenses/fixtures/${f}`, 'utf8')) as Fixture,
)
const truth: Truth[] = JSON.parse(
  readFileSync('sample/licenses/specimens/ground_truth.json', 'utf8'),
).specimens

function expected(image: string, field: string): string | null {
  const fields = truth.find((t) => t.image === slug(image))?.fields
  const value = fields?.[field]
  if (value === undefined) return null
  if (field === 'dob' || field === 'dl_expiry') return iso(String(value))
  // A card that prints given names on one line answers first_name with the
  // first of them; a street printed over two lines answers with both.
  if (Array.isArray(value)) return field === 'first_name' ? String(value[0]) : value.join('')
  return String(value)
}

const matches = (read: string, want: string): boolean => flat(read) === flat(want)

function scoredFields(f: Fixture) {
  const parsed = parseCandidates(extractFor(f.docType, f.detections, f.text))
  return withCrossPass(respaceAddresses(parsed, f.plainText), f.plainText)
}

describe('confidence against ground truth', () => {
  it('has ground truth to grade against', () => {
    // Guards the loop below: an empty or misloaded truth file would make
    // every assertion in it pass vacuously.
    expect(truth.length).toBeGreaterThan(5)
    expect(fixtures.length).toBeGreaterThan(5)
  })

  it('never scores a value that misreads the card at or above the quiet threshold', () => {
    let wrongChecked = 0

    for (const f of fixtures) {
      if (!truth.some((t) => t.image === slug(f.image))) continue

      for (const c of scoredFields(f)) {
        const want = expected(f.image, c.key)
        if (want === null) continue // no ground truth for this field
        if (matches(c.raw, want)) continue // correct read, nothing to guard

        wrongChecked += 1
        const score = scoreEvidence(c.evidence)
        expect(
          score,
          `${slug(f.image)} ${c.key}=${JSON.stringify(c.raw)} want ${JSON.stringify(want)} scored ${score}`,
        ).toBeLessThan(QUIET_THRESHOLD)
      }
    }

    // Guards the assertion above: if the corpus never contains a misread,
    // the loop never runs it and this test cannot fail.
    expect(wrongChecked).toBeGreaterThan(0)
  })

  it('keeps the CA licence and ID number misreads — the glyph signal\'s own case — out of the quiet threshold', () => {
    // The card prints I1234568 / I1234561; OCR reads 11234568 / 11234561. A
    // human ruled these in as the reason glyphAmbiguous exists; if this
    // regresses, that signal is disconnected again regardless of what the
    // unit tests above say in isolation.
    const cases: readonly [string, string][] = [['ca_2019.png', 'dl_number'], ['ca_id_2010.png', 'id_number']]

    for (const [image, key] of cases) {
      const fixture = fixtures.find((f) => slug(f.image) === image)
      expect(fixture, image).toBeDefined()
      const candidate = scoredFields(fixture!).find((c) => c.key === key)
      expect(candidate, `${image} ${key}`).toBeDefined()

      const want = expected(image, key)
      expect(matches(candidate!.raw, want ?? ''), `${image} ${key}=${candidate!.raw} want ${want}`)
        .toBe(false)
      expect(candidate!.evidence.glyphAmbiguous, `${image} ${key}`).toBe(true)
      expect(scoreEvidence(candidate!.evidence), `${image} ${key}=${candidate!.raw}`)
        .toBeLessThan(QUIET_THRESHOLD)
    }
  })

  it('re-spaces a genuinely correct address into cross-pass agreement', () => {
    // Before re-spacing, WA's own street and city — spelled correctly by
    // both passes — disagreed on nothing but the missing spaces and scored
    // 0.47. That was the cross-pass signal lying about every address.
    const wa = fixtures.find((f) => slug(f.image) === 'wa_enhanced.png')
    const scored = scoredFields(wa!)
    const line1 = scored.find((c) => c.key === 'addr_line1')
    const city = scored.find((c) => c.key === 'addr_city')

    expect(line1?.raw).toBe('123 STREET ADDRESS')
    expect(city?.raw).toBe('YOUR CITY')
    expect(line1?.evidence.crossPassAgreed).toBe(true)
    expect(city?.evidence.crossPassAgreed).toBe(true)
    expect(scoreEvidence(line1!.evidence)).toBeGreaterThanOrEqual(QUIET_THRESHOLD)
    expect(scoreEvidence(city!.evidence)).toBeGreaterThanOrEqual(QUIET_THRESHOLD)
  })

  /**
   * Locked rather than counted, same reasoning as aamva-recall.test.ts's
   * TOTALS: measured before re-spacing (2026-08-02) at 10 of 28 address
   * fields quiet, 19 agreed / 9 disagreed. After: 13 quiet, 24 agreed / 4
   * disagreed — every flip is a spacing artefact going away, not a misread
   * being waved through (the test above and the CA/VA glyph cases guard
   * that). `ma_2016`'s `addr_line1` stays unspaced on purpose: its plain
   * pass drops the house number entirely, so no window of the full value's
   * length lines up closely enough to trust. `dc_2018`'s `addr_line1` does
   * re-space correctly (to "1234 COMMODORE JOSHUA BARNEY DRIVE, NE #1234")
   * but still disagrees: its plain pass breaks the line before "#1234" with
   * two trailing spaces and a newline, not the single space re-spacing
   * inserts, so `isWholeWordMatch`'s exact substring search misses it —
   * a whitespace-shape gap in cross-pass matching, not this task's to fix.
   */
  it('quiets 13 of 28 address fields across the corpus, up from 10 before re-spacing', () => {
    const ADDR = new Set(['addr_line1', 'addr_city', 'addr_state', 'addr_zip'])
    let total = 0
    let quiet = 0
    let agreed = 0
    let disagreed = 0

    for (const f of fixtures) {
      for (const c of scoredFields(f)) {
        if (!ADDR.has(c.key)) continue
        total += 1
        if (scoreEvidence(c.evidence) >= QUIET_THRESHOLD) quiet += 1
        if (c.evidence.crossPassAgreed === true) agreed += 1
        if (c.evidence.crossPassAgreed === false) disagreed += 1
      }
    }

    // Guards the tallies below: an empty corpus would pass every count as 0.
    expect(total).toBe(28)
    expect(quiet).toBe(13)
    expect(agreed).toBe(24)
    expect(disagreed).toBe(4)
  })
})
