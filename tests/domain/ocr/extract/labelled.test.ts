import { describe, expect, it } from 'vitest'
import { extractLabelled } from '@/domain/ocr/extract/labelled'
import type { Detection } from '@/domain/ocr/grounding'

const det = (text: string): Detection => ({ text, box: [100, 100, 400, 130] })

describe('extractLabelled', () => {
  it('reads a licence number from its label', () => {
    const out = extractLabelled([det('License No. GA-DLR-99481')], '')
    expect(out.find((c) => c.key === 'license_number#0')?.raw).toBe('GA-DLR-99481')
  })

  it('accepts a spelling variant from the synonym table', () => {
    const out = extractLabelled([det('Licence Number: GA-DLR-99481')], '')
    expect(out.find((c) => c.key === 'license_number#0')?.raw).toBe('GA-DLR-99481')
  })

  it('keys licence fields to instance zero', () => {
    // The requirements engine instances licences; an extractor that emits a
    // bare `license_number` writes to a key nothing asks for.
    const out = extractLabelled([det('License No. X-1')], '')
    for (const candidate of out) {
      expect(candidate.key.startsWith('license_')).toBe(true)
      expect(candidate.key).toContain('#0')
    }
  })

  it('reads an expiry into ISO form', () => {
    const out = extractLabelled([det('Expires 06/30/2027')], '')
    expect(out.find((c) => c.key === 'license_expiry#0')?.raw).toBe('2027-06-30')
  })

  it('never claims a label it did not find', () => {
    expect(extractLabelled([det('UNRELATED TEXT')], '')).toEqual([])
  })

  it('marks its candidates as label-anchored but not checksum-backed', () => {
    const [first] = extractLabelled([det('License No. X-1234')], '')
    expect(first?.evidence.labelAnchored).toBe(true)
    expect(first?.evidence.checksumValid).toBeNull()
  })
})
