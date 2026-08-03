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
    const out = extractMrz([], MRZ)
    // Guards the loop below: an extractor gone silent would otherwise pass.
    expect(out.length).toBeGreaterThan(0)
    for (const candidate of out) {
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
    const out = extractMrz([], MRZ)
    // Guards the loop below: an extractor gone silent would otherwise pass.
    expect(out.length).toBeGreaterThan(0)
    for (const candidate of out) {
      expect(candidate.box).toBeUndefined()
    }
  })

  it('returns nothing when there is no MRZ', () => {
    expect(extractMrz([], 'JUST SOME TEXT')).toEqual([])
  })
})
