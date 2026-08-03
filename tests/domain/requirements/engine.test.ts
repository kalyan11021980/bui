import { describe, it, expect } from 'vitest'
import { requiredFields } from '@/domain/requirements/engine'
import { CATALOG } from '@/domain/catalog'
import { parseReqKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const base: ApplicantProfile = {
  applicantType: 'individual',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: [],
  addressDiffersFromId: false,
  idForm: 'drivers_license',
}

describe('requiredFields', () => {
  it('asks an individual for identity, address and mobile', () => {
    const k = requiredFields(base)
    expect(k).toContain('first_name')
    expect(k).toContain('dob')
    expect(k).toContain('addr_line1')
    expect(k).toContain('phone_mobile')
  })

  it('never asks an individual for business or licence fields', () => {
    const k = requiredFields(base)
    expect(k).not.toContain('biz_legal_name')
    expect(k).not.toContain('license_number#0')
  })

  it('asks a business for business fields and a taxpayer ID', () => {
    const k = requiredFields({ ...base, applicantType: 'business' })
    expect(k).toContain('biz_name')
    expect(k).toContain('biz_legal_name')
    expect(k).toContain('tax_id')
  })

  it('asks for no licence fields when a business holds none', () => {
    const k = requiredFields({ ...base, applicantType: 'business' })
    expect(k.some((x) => x.startsWith('license_'))).toBe(false)
  })

  it('asks for one licence group per licence held', () => {
    const k = requiredFields({
      ...base, applicantType: 'business', licenses: ['dealer', 'salvage'],
    })
    expect(k).toContain('license_number#0')
    expect(k).toContain('license_number#1')
    expect(k).not.toContain('license_number#2')
    expect(k).toContain('license_expiry#0')
    expect(k).toContain('license_expiry#1')
  })

  it('adds GSA fields only when the applicant wants GSA', () => {
    expect(requiredFields(base)).not.toContain('gsa_bidder_number')
    expect(requiredFields({ ...base, wantsGsa: true }))
      .toContain('gsa_bidder_number')
  })

  it('adds the Ohio form for an Ohio applicant and not a Georgia one', () => {
    expect(requiredFields({ ...base, state: 'OH' }))
      .toContain('oh_foreign_buyer_form')
    expect(requiredFields({ ...base, state: 'GA' }))
      .not.toContain('oh_foreign_buyer_form')
  })

  it('handles an unknown or absent state without inventing requirements', () => {
    expect(requiredFields({ ...base, state: null }))
      .not.toContain('oh_foreign_buyer_form')
    expect(requiredFields({ ...base, state: 'ZZ' }))
      .not.toContain('oh_foreign_buyer_form')
  })

  it('is case-insensitive about the state code', () => {
    expect(requiredFields({ ...base, state: 'oh' }))
      .toContain('oh_foreign_buyer_form')
  })

  it('omits optional fields — line 2 is never required', () => {
    const k = requiredFields({ ...base, applicantType: 'business' })
    expect(k).not.toContain('addr_line2')
    expect(k).not.toContain('biz_addr_line2')
  })

  it('returns no duplicates', () => {
    const k = requiredFields({
      ...base, applicantType: 'business', wantsGsa: true,
      licenses: ['dealer', 'salvage'], state: 'OH',
    })
    expect(new Set(k).size).toBe(k.length)
  })

  it('returns the exact expected set for an individual in Georgia', () => {
    expect([...requiredFields(base)].sort()).toEqual([
      'addr_city', 'addr_line1', 'addr_state', 'addr_zip',
      'dl_expiry', 'dl_number', 'dob', 'first_name',
      'id_country', 'id_images', 'id_state',
      'last_name', 'phone_mobile', 'preferred_language', 'primary_activity',
    ])
  })

  it('resolves every key it returns to a real catalog field', () => {
    const profiles: ApplicantProfile[] = [
      base,
      { ...base, applicantType: 'business', licenses: ['dealer'] },
      { ...base, wantsGsa: true },
      { ...base, state: null },
      { ...base, idForm: 'state_id' },
      { ...base, idForm: 'passport' },
      { ...base, state: 'OH', applicantType: 'business', licenses: ['dealer', 'salvage'] },
    ]
    for (const p of profiles) {
      for (const key of requiredFields(p)) {
        const { fieldId } = parseReqKey(key)
        expect(CATALOG.has(fieldId), `catalog is missing ${fieldId}`).toBe(true)
      }
    }
  })
})

describe('the declared ID form decides which number is owed', () => {
  const NUMBERS = ['dl_number', 'id_number', 'passport_number'] as const

  /** Exactly one, never two, never none — asserted as a set, not a contains. */
  const numbersAsked = (profile: ApplicantProfile) =>
    NUMBERS.filter((n) => requiredFields(profile).includes(n))

  it('asks a licence holder for the licence number and nothing else', () => {
    expect(numbersAsked({ ...base, idForm: 'drivers_license' })).toEqual(['dl_number'])
  })

  it('asks a state ID holder for the ID card number, not a licence number', () => {
    // The state ID prints a number; before this it had nowhere to land.
    expect(numbersAsked({ ...base, idForm: 'state_id' })).toEqual(['id_number'])
  })

  it('asks a passport holder for the passport number, not a licence number', () => {
    // Pre-existing defect: every applicant owed a driver's licence number.
    expect(numbersAsked({ ...base, idForm: 'passport' })).toEqual(['passport_number'])
  })

  it('asks which state issued a licence or an ID card', () => {
    expect(requiredFields({ ...base, idForm: 'drivers_license' })).toContain('id_state')
    expect(requiredFields({ ...base, idForm: 'state_id' })).toContain('id_state')
  })

  it('does not ask a passport holder for an issuing state, which it has none of', () => {
    const keys = requiredFields({ ...base, idForm: 'passport' })
    expect(keys).not.toContain('id_state')
    // Guards the negative: the rest of identity is still asked for.
    expect(keys).toContain('id_country')
    expect(keys).toContain('id_images')
  })

  it('returns the exact expected set for a passport holder', () => {
    expect([...requiredFields({ ...base, idForm: 'passport' })].sort()).toEqual([
      'addr_city', 'addr_line1', 'addr_state', 'addr_zip',
      'dl_expiry', 'dob', 'first_name',
      'id_country', 'id_images', 'last_name', 'passport_number',
      'phone_mobile', 'preferred_language', 'primary_activity',
    ])
  })

  it('keeps each section contiguous, so the panel groups it as one block', () => {
    // The number and issuing state are appended by the engine rather than by
    // CORE_IDENTITY; appending them after contact would split identification
    // in two and the panel would show a different order from the engine's.
    for (const idForm of ['drivers_license', 'state_id', 'passport'] as const) {
      const sections = requiredFields({ ...base, idForm })
        .map((k) => CATALOG.get(parseReqKey(k).fieldId)?.section)
      const runs = sections.filter((s, i) => s !== sections[i - 1])
      expect(new Set(runs).size, idForm).toBe(runs.length)
    }
  })
})
