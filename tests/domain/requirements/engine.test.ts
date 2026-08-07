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
  bizCountry: null,
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

  it('does not bind a stale US state to a non-US applicant', () => {
    // location_state answered 'OH' while country was still the US default,
    // then location_country moved to 'CAN' — profile.state is unchanged
    // (no asked field can unset it), so the state gate must not fire.
    expect(requiredFields({ ...base, country: 'CAN', state: 'OH' }))
      .not.toContain('oh_foreign_buyer_form')
    expect(requiredFields({ ...base, country: 'US', state: 'OH' }))
      .toContain('oh_foreign_buyer_form')
  })

  it('returns the exact expected set for an individual in Georgia', () => {
    expect([...requiredFields(base)].sort()).toEqual([
      'addr_city', 'addr_line1', 'addr_state', 'addr_zip',
      'address_differs', 'applicant_type',
      'dl_expiry', 'dl_number', 'dob', 'first_name',
      'id_country', 'id_form', 'id_images', 'id_state',
      'last_name', 'location_country', 'location_state',
      'phone_mobile', 'phone_primary', 'preferred_language', 'primary_activity',
      'wants_gsa',
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
  const ID_FORMS = ['drivers_license', 'state_id', 'passport'] as const

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

  it('returns the exact expected set for a state ID holder', () => {
    expect([...requiredFields({ ...base, idForm: 'state_id' })].sort()).toEqual([
      'addr_city', 'addr_line1', 'addr_state', 'addr_zip',
      'address_differs', 'applicant_type',
      'dl_expiry', 'dob', 'first_name',
      'id_country', 'id_form', 'id_images', 'id_number', 'id_state',
      'last_name', 'location_country', 'location_state',
      'phone_mobile', 'phone_primary', 'preferred_language', 'primary_activity',
      'wants_gsa',
    ])
  })

  it('returns the exact expected set for a passport holder', () => {
    expect([...requiredFields({ ...base, idForm: 'passport' })].sort()).toEqual([
      'addr_city', 'addr_line1', 'addr_state', 'addr_zip',
      'address_differs', 'applicant_type',
      'dl_expiry', 'dob', 'first_name',
      'id_country', 'id_form', 'id_images', 'last_name',
      'location_country', 'location_state', 'passport_number',
      'phone_mobile', 'phone_primary', 'preferred_language', 'primary_activity',
      'wants_gsa',
    ])
  })

  it('returns no duplicates, whichever document is declared', () => {
    for (const idForm of ID_FORMS) {
      const k = requiredFields({
        ...base, idForm, applicantType: 'business', wantsGsa: true,
        licenses: ['dealer', 'salvage'], state: 'OH',
      })
      expect(new Set(k).size, idForm).toBe(k.length)
    }
  })

  it('asks for identity in one order, whichever document is declared', () => {
    // The number belongs beside the other document fields. Appended after
    // id_images instead, the panel asks for photographs of the ID before the
    // number printed on it, and section order is not enough to catch that.
    const identity = (
      idForm: ApplicantProfile['idForm'],
      addressDiffersFromId = false,
    ) =>
      requiredFields({ ...base, idForm, addressDiffersFromId })
        .filter((k) => CATALOG.get(parseReqKey(k).fieldId)?.section === 'identification')

    expect(identity('drivers_license')).toEqual([
      'first_name', 'last_name', 'dl_number', 'dl_expiry',
      'id_country', 'id_state', 'dob', 'id_images',
    ])
    expect(identity('state_id')).toEqual([
      'first_name', 'last_name', 'id_number', 'dl_expiry',
      'id_country', 'id_state', 'dob', 'id_images',
    ])
    expect(identity('passport')).toEqual([
      'first_name', 'last_name', 'passport_number', 'dl_expiry',
      'id_country', 'dob', 'id_images',
    ])

    // Proof of residency is an identity field by its own section, so it is
    // emitted with identity. Pushed on where the condition is read, it lands
    // after address and contact and the panel and the engine disagree.
    expect(identity('drivers_license', true)).toEqual([
      'first_name', 'last_name', 'dl_number', 'dl_expiry',
      'id_country', 'id_state', 'dob', 'id_images', 'proof_of_residency',
    ])
    expect(identity('passport', true)).toEqual([
      'first_name', 'last_name', 'passport_number', 'dl_expiry',
      'id_country', 'dob', 'id_images', 'proof_of_residency',
    ])
  })

  it('keeps each section contiguous, whatever the applicant declares', () => {
    // Identity is composed in one place; emitting any conditional part of it
    // later would split identification in two, and the panel would show a
    // different order from the one the engine validates. Both declarations
    // are swept: asserting this only for addressDiffersFromId: false tested
    // it exactly where it could not fail.
    for (const idForm of ID_FORMS) {
      for (const addressDiffersFromId of [false, true]) {
        const where = `${idForm}, addressDiffers=${addressDiffersFromId}`
        const sections = requiredFields({ ...base, idForm, addressDiffersFromId })
          .map((k) => CATALOG.get(parseReqKey(k).fieldId)?.section)
        const runs = sections.filter((s, i) => s !== sections[i - 1])
        expect(new Set(runs).size, where).toBe(runs.length)
      }
    }
  })
})

describe('profile determinants and expansions', () => {
  it('asks everyone the determinants first', () => {
    const k = requiredFields(base)
    for (const id of ['applicant_type', 'location_country', 'location_state',
      'id_form', 'address_differs', 'wants_gsa']) {
      expect(k).toContain(id)
    }
    expect(k).not.toContain('licenses_held')
  })

  it('asks a business which licences it holds, and the full tax trio', () => {
    const k = requiredFields({ ...base, applicantType: 'business' })
    expect(k).toContain('licenses_held')
    expect(k).toContain('tax_classification')
    expect(k).toContain('tax_certification')
  })

  it('swaps US state/zip for region/postal outside the US', () => {
    const k = requiredFields({ ...base, country: 'CAN' })
    expect(k).not.toContain('location_state')
    expect(k).toContain('addr_region')
    expect(k).toContain('addr_postal')
    expect(k).not.toContain('addr_state')
    expect(k).not.toContain('addr_zip')
  })

  it('swaps the business address block on bizCountry', () => {
    const k = requiredFields({ ...base, applicantType: 'business', bizCountry: 'MEX' })
    expect(k).toContain('biz_country')
    expect(k).toContain('biz_addr_region')
    expect(k).not.toContain('biz_addr_state')
  })

  it('requires both phones of everyone', () => {
    const k = requiredFields(base)
    expect(k).toContain('phone_primary')
    expect(k).toContain('phone_mobile')
  })
})
