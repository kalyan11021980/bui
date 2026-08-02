import { describe, it, expect } from 'vitest'
import { requiredFields } from '@/domain/requirements/engine'
import { CATALOG } from '@/domain/catalog'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const base: ApplicantProfile = {
  applicantType: 'individual',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenseCount: 0,
}

describe('requiredFields', () => {
  it('asks an individual for identity, address and mobile', () => {
    const ids = requiredFields(base)
    expect(ids).toContain('first_name')
    expect(ids).toContain('dob')
    expect(ids).toContain('addr_line1')
    expect(ids).toContain('phone_mobile')
  })

  it('never asks an individual for business or license fields', () => {
    const ids = requiredFields(base)
    expect(ids).not.toContain('biz_legal_name')
    expect(ids).not.toContain('license_number')
  })

  it('asks a business for business and license fields', () => {
    const ids = requiredFields({
      ...base,
      applicantType: 'business',
      licenseCount: 1,
    })
    expect(ids).toContain('biz_name')
    expect(ids).toContain('biz_legal_name')
    expect(ids).toContain('license_number')
    expect(ids).toContain('license_expiry')
  })

  it('asks a business for a taxpayer ID and an individual not', () => {
    expect(requiredFields({ ...base, applicantType: 'business' }))
      .toContain('tax_id')
    expect(requiredFields(base)).not.toContain('tax_id')
  })

  it('adds GSA fields only when the applicant wants GSA', () => {
    expect(requiredFields(base)).not.toContain('gsa_bidder_number')
    expect(requiredFields({ ...base, wantsGsa: true }))
      .toContain('gsa_bidder_number')
  })

  it('omits optional fields — line 2 is never required', () => {
    const ids = requiredFields({ ...base, applicantType: 'business' })
    expect(ids).not.toContain('addr_line2')
    expect(ids).not.toContain('biz_addr_line2')
  })

  it('returns no duplicates', () => {
    const ids = requiredFields({
      ...base,
      applicantType: 'business',
      wantsGsa: true,
      licenseCount: 2,
    })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns only ids that exist in the catalog', () => {
    const profiles: ApplicantProfile[] = [
      base,
      { ...base, applicantType: 'business', licenseCount: 1 },
      { ...base, wantsGsa: true },
      { ...base, state: null },
    ]
    for (const p of profiles) {
      for (const id of requiredFields(p)) {
        expect(CATALOG.has(id), `catalog is missing ${id}`).toBe(true)
      }
    }
  })
})
