import { describe, it, expect } from 'vitest'
import { IDENTITY_FIELDS } from '@/domain/catalog/identity'
import { ADDRESS_FIELDS } from '@/domain/catalog/address'
import { CONTACT_FIELDS } from '@/domain/catalog/contact'

describe('personal catalog', () => {
  const all = [...IDENTITY_FIELDS, ...ADDRESS_FIELDS, ...CONTACT_FIELDS]

  it('gives every field a non-empty purpose and an authority', () => {
    for (const f of all) {
      expect(f.purpose.trim(), f.id).not.toBe('')
      expect(f.authority, f.id).toBeTruthy()
    }
  })

  it('marks the DL number as derivable from a driver licence', () => {
    const dl = IDENTITY_FIELDS.find((f) => f.id === 'dl_number')
    expect(dl?.derivableFrom).toContain('drivers_license')
  })

  it('validates a date of birth as an ISO date', () => {
    const dob = IDENTITY_FIELDS.find((f) => f.id === 'dob')
    expect(dob?.validation.safeParse('1982-08-31').success).toBe(true)
    expect(dob?.validation.safeParse('31/08/1982').success).toBe(false)
  })

  it('rejects a malformed zip code', () => {
    const zip = ADDRESS_FIELDS.find((f) => f.id === 'addr_zip')
    expect(zip?.validation.safeParse('30301').success).toBe(true)
    expect(zip?.validation.safeParse('3O3O1').success).toBe(false)
  })

  it('gives handling copy to every sensitive field', () => {
    for (const f of all.filter((x) => x.sensitive)) {
      expect(f.handling?.trim(), f.id).toBeTruthy()
    }
  })
})
