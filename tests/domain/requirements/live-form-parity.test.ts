import { describe, it, expect } from 'vitest'
import { requiredFields } from '@/domain/requirements/engine'
import { fieldDef } from '@/domain/catalog'
import type { ApplicantProfile } from '@/domain/requirements/rules'

/**
 * Parity with the registration IAA runs today, read off screenshots of the
 * live flow on 2026-08-02. Each case is a field that flow requires and this
 * engine did not ask for.
 */

const individual: ApplicantProfile = {
  applicantType: 'individual',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: [],
  addressDiffersFromId: false,
}

const business: ApplicantProfile = {
  ...individual, applicantType: 'business', licenses: ['dealer'],
}

describe('parity with the live registration', () => {
  it('asks everyone for primary activity and preferred language', () => {
    // "Complete your profile": PRIMARY ACTIVITY and PREFERRED LANGUAGE are
    // both required there and had no catalog entry at all.
    const keys = requiredFields(individual)
    expect(keys).toContain('primary_activity')
    expect(keys).toContain('preferred_language')
  })

  it('asks which country and state issued the ID', () => {
    // "Set up your identification": COUNTRY and STATE sit beside the licence
    // number, and identify the issuing authority we check against.
    const keys = requiredFields(individual)
    expect(keys).toContain('id_country')
    expect(keys).toContain('id_state')
  })

  it('asks which country issued each licence', () => {
    const keys = requiredFields({ ...business, licenses: ['dealer', 'salvage'] })
    expect(keys).toContain('license_country#0')
    expect(keys).toContain('license_country#1')
  })

  it('asks for proof of residency only when the address differs from the ID', () => {
    // "My address is different than the one on my ID. I will provide an image
    // with another proof of residency."
    expect(requiredFields(individual)).not.toContain('proof_of_residency')
    expect(requiredFields({ ...individual, addressDiffersFromId: true }))
      .toContain('proof_of_residency')
  })

  it('keeps proof of residency out of the way for a matching business address', () => {
    expect(requiredFields(business)).not.toContain('proof_of_residency')
  })

  it('justifies every newly added field, like every other', () => {
    for (const id of [
      'primary_activity', 'preferred_language',
      'id_country', 'id_state', 'license_country', 'proof_of_residency',
    ] as const) {
      const def = fieldDef(id)
      expect(def.purpose.trim(), id).not.toBe('')
      expect(def.authority, id).toBeTruthy()
      expect(def.label.trim(), id).not.toBe('')
    }
  })

  it('treats proof of residency as sensitive, and so gives it handling copy', () => {
    // A utility bill carries a name and a home address.
    const def = fieldDef('proof_of_residency')
    expect(def.sensitive).toBe(true)
    expect(def.handling?.trim()).toBeTruthy()
  })
})
