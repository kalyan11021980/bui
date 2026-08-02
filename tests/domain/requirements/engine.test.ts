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
      'id_form', 'id_images', 'last_name', 'phone_mobile',
    ])
  })

  it('resolves every key it returns to a real catalog field', () => {
    const profiles: ApplicantProfile[] = [
      base,
      { ...base, applicantType: 'business', licenses: ['dealer'] },
      { ...base, wantsGsa: true },
      { ...base, state: null },
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
