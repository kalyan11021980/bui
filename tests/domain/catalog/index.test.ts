import { describe, it, expect } from 'vitest'
import { CATALOG, fieldDef, ALL_FIELDS } from '@/domain/catalog'

describe('catalog index', () => {
  it('has no duplicate field ids', () => {
    const ids = ALL_FIELDS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires purpose and authority on every field — the spec guarantee', () => {
    for (const f of ALL_FIELDS) {
      expect(f.purpose.trim(), f.id).not.toBe('')
      expect(f.authority, f.id).toBeTruthy()
    }
  })

  it('never marks a sensitive field orchestrator-visible', () => {
    for (const f of ALL_FIELDS) {
      if (f.sensitive) {
        expect(
          (f as { orchestratorVisible?: boolean }).orchestratorVisible,
          f.id,
        ).not.toBe(true)
      }
    }
  })

  it('looks a field up by id', () => {
    expect(fieldDef('tax_id').authority).toBe('IRS')
    expect(CATALOG.size).toBe(ALL_FIELDS.length)
  })

  it('throws on an unknown id', () => {
    // @ts-expect-error deliberately invalid
    expect(() => fieldDef('nope')).toThrow(/unknown field/i)
  })

  it('gives the taxpayer ID handling copy, since it is the scariest ask', () => {
    const tax = fieldDef('tax_id')
    expect(tax.sensitive).toBe(true)
    expect(tax.handling?.trim()).toBeTruthy()
    expect(tax.destination).toBeTruthy()
  })

  it('resolves the new determinant and tax fields with their wire values', () => {
    expect(fieldDef('applicant_type').options?.map((o) => o.value))
      .toEqual(['business', 'individual'])
    expect(fieldDef('licenses_held').type).toBe('multiselect')
    expect(fieldDef('tax_certification').attestation).toBe('w9_certification')
    expect(fieldDef('wants_gsa').validation.safeParse('yes').success).toBe(true)
    expect(fieldDef('licenses_held').validation.safeParse([]).success).toBe(false)
  })
})
