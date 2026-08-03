import { describe, expect, it } from 'vitest'
import { extractLabelled } from '@/domain/ocr/extract/labelled'
import type { Box, Detection } from '@/domain/ocr/grounding'

const det = (text: string): Detection => ({ text, box: [100, 100, 400, 130] })
const at = (text: string, box: Box): Detection => ({ text, box })

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

  it('flags a licence number as glyph-ambiguous when it carries a confusable character', () => {
    // license_number is identifier-shaped; I0123 mixes a capital I with 0 and 1.
    const out = extractLabelled([det('License No. I0123')], '')
    expect(out.find((c) => c.key === 'license_number#0')?.evidence.glyphAmbiguous).toBe(true)
  })

  it('does not flag a licence number free of confusable characters', () => {
    const out = extractLabelled([det('License No. XYZ-9992')], '')
    expect(out.find((c) => c.key === 'license_number#0')?.evidence.glyphAmbiguous).toBe(false)
  })

  it('reads a merged label and value that starts with a letter', () => {
    // Real DeepSeek behaviour: label and value can arrive as one detection
    // with no separator at all (`4dLIC#WDLJK00580GF` in the acceptance gate
    // record). A blanket "next character is a letter" guard would drop this.
    const out = extractLabelled([det('LIC# WDLJK00580GF')], '')
    expect(out.find((c) => c.key === 'license_number#0')?.raw).toBe('WDLJK00580GF')
  })

  it('still yields nothing for a label-only detection with no neighbour at all', () => {
    // Regression guard for the fix above: "EFFECTIVE DATE" alone must not
    // read "DATE" as the effective date just because letter-leading merged
    // values are now accepted.
    expect(extractLabelled([det('EFFECTIVE DATE')], '')).toEqual([])
  })

  it('does not pair a label with a neighbouring label when the real value is missing', () => {
    // OCR can lose a value while keeping its label — the acceptance gate
    // documents this happening for real (a ZIP came back as a fragment of
    // the surrounding text). Without a same-document label filter, the
    // nearest surviving detection below "LICENSE NUMBER" would be the next
    // label down the page, "LICENSE TYPE", and it would be read as if it
    // were the licence number.
    const out = extractLabelled([
      at('LICENSE NUMBER', [91, 320, 233, 344]),
      at('LICENSE TYPE', [90, 392, 205, 416]),
      at('USED MOTOR VEHICLE DEALER', [91, 425, 462, 453]),
    ], '')
    expect(out.find((c) => c.key === 'license_number#0')).toBeUndefined()
  })

  it('rejects a date that is not a real calendar date', () => {
    // isRealCalendarDate round-trips through the calendar; February has no
    // 30th, so this must be dropped rather than normalised to March.
    expect(extractLabelled([det('Expires 02/30/2027')], '')).toEqual([])
  })
})
