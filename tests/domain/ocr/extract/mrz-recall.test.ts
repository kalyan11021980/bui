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
    // mangles the zone.
    const out = extractMrz([], `${TRUE_LINE1}\n${TRUE_LINE2}`)
    const value = (key: string) => out.find((c) => c.key === key)?.raw

    expect(value('last_name')).toBe('DE BRUIJN')
    expect(value('first_name')).toBe('WILLEKE')
    expect(value('id_country')).toBe('NLD')
    expect(value('passport_number')).toBe('SPECI2014')
    expect(value('dob')).toBe(expected?.dob)
    expect(value('dl_expiry')).toBe(expected?.dl_expiry)
    expect(out).toHaveLength(6)
  })

  it('reads nothing off the recorded OCR: the grounded pass truncated both MRZ lines', () => {
    // The recorder captured the image faithfully enough for a human to read
    // (verified above), but the grounded OCR pass dropped trailing filler off
    // both lines: 41 characters where line 1 prints 44, 43 where line 2
    // prints 44. findMrzLines' fixed-width gate is exact for a reason — a
    // short line is not a line we can safely re-slice — so it declines both,
    // and extraction yields nothing. A real OCR limitation, not a reason to
    // loosen the gate.
    expect(findMrzLines(card.text)).toBeNull()
    expect(extractFor(card.docType, card.detections, card.text)).toEqual([])

    const asRead = card.detections.map((d) => d.text)
    expect(asRead).toContain('P<NLDDE<BRUIJN<<WILLEKE<LISELOTTE<<<<<<<<')
    expect(asRead).toContain('SPEC120142NLD6503101F24030969999999990<<<84')
  })

  it('would still have caught the misread document number on checksum alone', () => {
    // What the checksums alone would have done if the two OCR lines had been
    // 44 characters, using the OCR reading verbatim — not the ground truth —
    // padded with trailing filler past the point this extractor ever reads
    // (nothing past index 27 feeds a field). This isolates OCR's one real
    // content error, distinct from the truncation above: a glyph swap, I for
    // 1, inside the document number — exactly the CA card's failure class,
    // caught here by arithmetic instead of a human skimming it.
    // The visual `documentnummer` field is a shorter, separate detection that
    // also starts `SPEC1` — match on length to land on the MRZ line, not it.
    const ocrLine1 = card.detections.find((d) => d.text.startsWith('P<NLD'))?.text ?? ''
    const ocrLine2 = card.detections.find((d) => d.text.startsWith('SPEC1') && d.text.length > 30)?.text ?? ''
    expect(ocrLine1).toHaveLength(41)
    expect(ocrLine2).toHaveLength(43)

    const padded = `${ocrLine1.padEnd(44, '<')}\n${ocrLine2.padEnd(44, '<')}`
    const out = extractMrz([], padded)
    const value = (key: string) => out.find((c) => c.key === key)?.raw

    // Names carry no check digit, so the glyph-clean parts of the zone still
    // come through.
    expect(value('last_name')).toBe('DE BRUIJN')
    expect(value('first_name')).toBe('WILLEKE')
    expect(value('id_country')).toBe('NLD')
    // Read correctly by OCR, so the checksum agrees and the value survives.
    expect(value('dob')).toBe(expected?.dob)
    expect(value('dl_expiry')).toBe(expected?.dl_expiry)
    // OCR's I→1 misread inside the document number: the checksum catches it.
    expect(value('passport_number')).toBeUndefined()
  })
})
