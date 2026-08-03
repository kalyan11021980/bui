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

  it('gives each document its own number field, derivable only from itself', () => {
    // Widening dl_number to state_id would file an ID card number under
    // "Driver's license number" in a record a human reviewer reads.
    for (const [id, docType] of [
      ['dl_number', 'drivers_license'], ['id_number', 'state_id'],
      ['passport_number', 'passport'],
    ] as const) {
      const def = IDENTITY_FIELDS.find((f) => f.id === id)
      expect(def?.derivableFrom, id).toEqual([docType])
    }
  })

  it('labels each number after the document it is printed on', () => {
    const label = (id: string) => IDENTITY_FIELDS.find((f) => f.id === id)?.label
    expect(label('dl_number')).toMatch(/driver/i)
    expect(label('id_number')).toMatch(/id card/i)
    expect(label('passport_number')).toMatch(/passport/i)
  })

  it('treats every document number as sensitive', () => {
    for (const id of ['dl_number', 'id_number', 'passport_number']) {
      const def = IDENTITY_FIELDS.find((f) => f.id === id)
      expect(def?.sensitive, id).toBe(true)
      expect(def?.handling?.trim(), id).toBeTruthy()
    }
  })

  it('no longer carries a form-of-ID field, which the profile now declares', () => {
    // Two representations of one fact drift; ApplicantProfile.idForm is the one.
    expect(IDENTITY_FIELDS.map((f) => f.id)).not.toContain('id_form')
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
