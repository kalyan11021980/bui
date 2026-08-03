import { describe, expect, it } from 'vitest'
import { checkDigit, extractMrz, findMrzLines } from '@/domain/ocr/extract/mrz'
import type { Detection } from '@/domain/ocr/grounding'

// ICAO Doc 9303 TD3 specimen.
const LINE1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
const LINE2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'

const det = (text: string): Detection => ({ text, box: [0, 0, 0, 0] })
const MRZ_DETECTIONS = [det(LINE1), det(LINE2)]

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
  it('finds the two lines among surrounding page detections', () => {
    const found = findMrzLines([det('PASSPORT'), det('UNITED STATES'), ...MRZ_DETECTIONS])
    expect(found?.[0]).toBe(LINE1)
    expect(found?.[1]).toBe(LINE2)
  })

  it('returns null when only one line is present', () => {
    expect(findMrzLines([det(LINE1)])).toBeNull()
  })

  it('does not mistake a page header for line 1', () => {
    // "PASSPORT" / "PASSEPORT" / "PASPOORT" all start with P and, unlike a
    // real MRZ line, carry no filler after the document code.
    expect(findMrzLines([det('PASSPORT'), det('PASSEPORT'), det('PASPOORT'), det(LINE2)]))
      .toBeNull()
  })
})

describe('extractMrz', () => {
  it('reads names, dates and issuing country', () => {
    const out = extractMrz(MRZ_DETECTIONS, '')
    const value = (key: string) => out.find((c) => c.key === key)?.raw

    expect(value('last_name')).toBe('ERIKSSON')
    expect(value('first_name')).toBe('ANNA')
    expect(value('dob')).toBe('1974-08-12')
    expect(value('dl_expiry')).toBe('2012-04-15')
    expect(value('id_country')).toBe('UTO')
  })

  it('marks only the line-2 fields checksum-validated', () => {
    // Line 1 carries no check digit at all; names and country must not claim
    // arithmetic verification they never had.
    const out = extractMrz(MRZ_DETECTIONS, '')
    // Guards the lookups below: an extractor gone silent would otherwise pass.
    expect(out.length).toBeGreaterThan(0)
    const checksum = (key: string) => out.find((c) => c.key === key)?.evidence.checksumValid

    expect(checksum('passport_number')).toBe(true)
    expect(checksum('dob')).toBe(true)
    expect(checksum('dl_expiry')).toBe(true)
    expect(checksum('last_name')).toBeNull()
    expect(checksum('first_name')).toBeNull()
    expect(checksum('id_country')).toBeNull()
  })

  it('flags the passport number as glyph-ambiguous, the one identifier here', () => {
    const out = extractMrz(MRZ_DETECTIONS, '')
    const found = out.find((c) => c.key === 'passport_number')
    // L898902C3 contains 8 and 0, both in the confusable set.
    expect(found?.evidence.glyphAmbiguous).toBe(true)
  })

  it('suppresses a field whose check digit fails', () => {
    // The exact failure class the CA card produced: a character misread inside
    // an identifier. Arithmetic catches it; an applicant skimming would not.
    const corrupted = det(LINE2.replace('7408122', '7408123'))
    const out = extractMrz([det(LINE1), corrupted], '')
    expect(out.find((c) => c.key === 'dob')).toBeUndefined()
    expect(out.find((c) => c.key === 'last_name')).toBeDefined()
  })

  it('suppresses dl_expiry when only its own check digit fails', () => {
    // Distinct from the dob corruption above: the expiry check-digit guard
    // needs its own coverage, not a free ride off a neighbouring field.
    const corrupted = det(LINE2.replace('1204159', '1204158'))
    const out = extractMrz([det(LINE1), corrupted], '')
    expect(out.find((c) => c.key === 'dl_expiry')).toBeUndefined()
    expect(out.find((c) => c.key === 'dob')).toBeDefined()
  })

  it('emits no box, because an MRZ line is not where the value is printed', () => {
    const out = extractMrz(MRZ_DETECTIONS, '')
    // Guards the loop below: an extractor gone silent would otherwise pass.
    expect(out.length).toBeGreaterThan(0)
    for (const candidate of out) {
      expect(candidate.box).toBeUndefined()
    }
  })

  it('returns nothing when there is no MRZ', () => {
    expect(extractMrz([det('JUST SOME TEXT')], '')).toEqual([])
  })
})
