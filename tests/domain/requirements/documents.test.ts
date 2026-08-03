import { describe, expect, it } from 'vitest'
import { documentsToUpload } from '@/domain/requirements/documents'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const individual: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}

describe('documentsToUpload', () => {
  it('asks only for the ID the applicant said they hold', () => {
    expect(documentsToUpload(individual)).toEqual(['drivers_license'])
    expect(documentsToUpload({ ...individual, idForm: 'passport' }))
      .toEqual(['passport'])
  })

  it('asks a licence holder for the licence itself', () => {
    expect(documentsToUpload({ ...individual, licenses: ['dealer'] }))
      .toEqual(['drivers_license', 'dealer_license'])
  })

  it('asks for proof of address when the address is not the one on the ID', () => {
    expect(documentsToUpload({ ...individual, addressDiffersFromId: true }))
      .toEqual(['drivers_license', 'proof_of_residency'])
  })

  it('asks for both when both apply, without asking for either twice', () => {
    expect(documentsToUpload({
      ...individual, licenses: ['dealer', 'salvage'], addressDiffersFromId: true,
    })).toEqual(['drivers_license', 'dealer_license', 'proof_of_residency'])
  })

  it('never asks for a document the profile does not require', () => {
    // The applicant went and found it, we read it, and nothing in their
    // application asks about any of it.
    expect(documentsToUpload(individual)).not.toContain('dealer_license')
    expect(documentsToUpload(individual)).not.toContain('proof_of_residency')
  })
})
