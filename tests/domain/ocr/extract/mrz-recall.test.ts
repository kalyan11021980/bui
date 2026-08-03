import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractFor } from '@/domain/ocr/extract'
import { extractMrz, findMrzLines } from '@/domain/ocr/extract/mrz'
import type { Detection } from '@/domain/ocr/grounding'

/**
 * Recall against the recorded nl_passport_2014 specimen, graded on values
 * transcribed by eye from the image (`specimens/ground_truth.json`) — never
 * on the recorded OCR `text`. Grading an extractor against OCR output measures
 * parsing, not reading, and would score a misread passport as a success.
 */

type Fixture = {
  docType: 'passport'
  image: string
  text: string
  detections: readonly Detection[]
}

type Truth = { image: string; fields: Record<string, string> }

const card: Fixture = JSON.parse(
  readFileSync('sample/licenses/fixtures/nl_passport_2014.json', 'utf8'),
)
const truth: Truth[] = JSON.parse(
  readFileSync('sample/licenses/specimens/ground_truth.json', 'utf8'),
).specimens

const slug = (path: string): string => path.split('/').pop() ?? path
const expected = truth.find((t) => t.image === slug(card.image))?.fields
const det = (text: string): Detection => ({ text, box: [0, 0, 0, 0] })

// MRZ names are all-caps; ground truth is transcribed as printed.
const upper = (field: 'last_name' | 'first_name'): string | undefined =>
  expected?.[field]?.toUpperCase()

// The specimen's own MRZ, character for character — verified by counting ink
// columns in the image (44 per line, monospace), not eyeballed.
const TRUE_LINE1 = 'P<NLDDE<BRUIJN<<WILLEKE<LISELOTTE<<<<<<<<<<<'
const TRUE_LINE2 = 'SPECI20142NLD6503101F2403096999999990<<<<<84'

describe('MRZ recall against the recorded specimen', () => {
  it('has the ground truth this suite depends on', () => {
    // Guards every test below: a missing entry would make them vacuously pass.
    expect(card.docType).toBe('passport')
    expect(expected).toBeDefined()
    expect(Object.keys(expected ?? {}).sort()).toEqual(
      ['dl_expiry', 'dob', 'first_name', 'id_country', 'last_name', 'passport_number'].sort(),
    )
  })

  it('reads every field once handed the passport’s actual 44-character MRZ', () => {
    // Both transcribed lines are internally consistent ICAO checksums — this
    // is the extractor's ceiling: what it gets right if nothing upstream
    // mangles the zone. Graded against ground truth, not hardcoded literals,
    // so an edit to the specimen file cannot go unnoticed here.
    const out = extractMrz([det(TRUE_LINE1), det(TRUE_LINE2)], '')
    const value = (key: string) => out.find((c) => c.key === key)?.raw

    expect(value('last_name')).toBe(upper('last_name'))
    expect(value('first_name')).toBe(upper('first_name'))
    expect(value('id_country')).toBe(expected?.id_country)
    expect(value('passport_number')).toBe(expected?.passport_number)
    expect(value('dob')).toBe(expected?.dob)
    expect(value('dl_expiry')).toBe(expected?.dl_expiry)
    expect(out).toHaveLength(6)
  })

  it('reads five of six fields off the recorded OCR, unpadded', () => {
    // The recorder captured the image faithfully enough for a human to read
    // (verified above), but the grounded OCR pass truncated trailing filler
    // off both MRZ lines: 41 characters where line 1 prints 44, 43 where
    // line 2 prints 44. A length gate would decline both. The structural
    // template `findMrzLines` actually uses only reads the first 28
    // characters of line 2 and the first 5 of line 1 — well inside the
    // truncation — so it finds both lines exactly as OCR recorded them, no
    // padding needed.
    const lines = findMrzLines(card.detections)
    expect(lines?.[0]).toHaveLength(41)
    expect(lines?.[1]).toHaveLength(43)

    const out = extractFor(card.docType, card.detections, card.text)
    const value = (key: string) => out.find((c) => c.key === key)?.raw

    // Names and country carry no check digit, so the glyph-clean parts of
    // the zone come through even off the truncated OCR reading.
    expect(value('last_name')).toBe(upper('last_name'))
    expect(value('first_name')).toBe(upper('first_name'))
    expect(value('id_country')).toBe(expected?.id_country)
    // Read correctly by OCR, so the checksum agrees and the value survives.
    expect(value('dob')).toBe(expected?.dob)
    expect(value('dl_expiry')).toBe(expected?.dl_expiry)
    // OCR's I→1 misread inside the document number (SPECI2014 read as
    // SPEC12014) fails the check digit — the exact failure class the CA card
    // produced, caught here by arithmetic instead of a human skimming it.
    expect(value('passport_number')).toBeUndefined()
    expect(out).toHaveLength(5)
  })

  it('would suppress dl_expiry alone if only its own check digit were misread', () => {
    // The brief's suppression coverage corrupts the DOB digit and checks
    // passport_number's recall — never dl_expiry's own guard. Corrupt only
    // the expiry composite digit on the true 44-character lines and confirm
    // nothing else is affected.
    const corrupted = TRUE_LINE2.replace('2403096', '2403097')
    const out = extractMrz([det(TRUE_LINE1), det(corrupted)], '')
    const value = (key: string) => out.find((c) => c.key === key)?.raw

    expect(out.find((c) => c.key === 'dl_expiry')).toBeUndefined()
    expect(value('dob')).toBe(expected?.dob)
    expect(value('passport_number')).toBe(expected?.passport_number)
  })
})
