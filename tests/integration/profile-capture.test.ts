import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import { sectionPlan } from '@/domain/orchestrator/plan'
import { checkAgainstRequirements } from '@/server/action-guard'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { ApplicationState } from '@/domain/application/state'

const T = '2026-08-07T12:00:00.000Z'

const START: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: null, wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

function fresh(): ApplicationState {
  return createApplication('app-1', START, 'tok')
}

/** Guard first, exactly as the action route does — a refused answer must fail the test. */
function answer(state: ApplicationState, fieldId: string, value: unknown): ApplicationState {
  const action = { type: 'SET_VALUE', fieldId, value, source: 'user', at: T } as const
  const refusal = checkAgainstRequirements(state, action)
  expect(refusal).toBeNull()
  return applicationReducer(state, action)
}

describe('persona: US individual', () => {
  it('starts at the profile section with the determinants, and never sees business', () => {
    const s = fresh()
    const plan = sectionPlan(s)!
    expect(plan.section).toBe('profile')
    expect(plan.fieldIds).toContain('applicant_type')
    expect(plan.fieldIds).not.toContain('licenses_held')

    const settled = answer(s, 'applicant_type', 'individual')
    const out = outstandingFields(settled)
    expect(out).not.toContain('biz_name')
    expect(out).not.toContain('tax_certification')
  })
})

describe('persona: US business with two licences', () => {
  it('unlocks licences, business, and the tax trio as answers land', () => {
    let s = fresh()
    s = answer(s, 'applicant_type', 'business')
    expect(outstandingFields(s)).toContain('licenses_held')

    s = answer(s, 'licenses_held', ['dealer', 'salvage'])
    const out = outstandingFields(s)
    expect(s.fields['license_type#0']?.value).toBe('dealer')
    expect(s.fields['license_type#1']?.value).toBe('salvage')
    expect(out).toContain('license_number#0')
    expect(out).toContain('license_number#1')
    expect(out).toContain('tax_classification')
    expect(out).toContain('tax_certification')
    expect(out).not.toContain('license_type#0')
  })

  it('refuses an empty licence declaration', () => {
    let s = fresh()
    s = answer(s, 'applicant_type', 'business')
    const refusal = checkAgainstRequirements(s, {
      type: 'SET_VALUE', fieldId: 'licenses_held', value: [], source: 'user', at: T,
    })
    expect(refusal).toContain('Select at least one license')
  })
})

describe('persona: non-US applicant', () => {
  it('swaps to region and postal, and drops the state ask', () => {
    let s = fresh()
    s = answer(s, 'location_country', 'CAN')
    const out = outstandingFields(s)
    expect(out).toContain('addr_region')
    expect(out).toContain('addr_postal')
    expect(out).not.toContain('addr_state')
    expect(out).not.toContain('location_state')
  })
})

describe('persona: GSA and address-differs', () => {
  it('wants_gsa yes unlocks the gsa section; no keeps it out', () => {
    let yes = fresh()
    yes = answer(yes, 'wants_gsa', 'yes')
    expect(outstandingFields(yes)).toContain('gsa_bidder_number')

    let no = fresh()
    no = answer(no, 'wants_gsa', 'no')
    expect(outstandingFields(no)).not.toContain('gsa_bidder_number')
  })

  it('address_differs yes requires proof of residency', () => {
    let s = fresh()
    s = answer(s, 'address_differs', 'yes')
    expect(outstandingFields(s)).toContain('proof_of_residency')
  })
})

describe('volunteered facts are never asked twice', () => {
  it('a setProfile patch settles the bridged asks', () => {
    let s = fresh()
    s = applicationReducer(s, {
      type: 'UPDATE_PROFILE', at: T,
      patch: { applicantType: 'business', state: 'GA', licenses: ['dealer'] },
    })
    const out = outstandingFields(s)
    expect(out).not.toContain('applicant_type')
    expect(out).not.toContain('location_state')
    expect(out).not.toContain('licenses_held')
    expect(out).not.toContain('license_type#0')
    expect(out).toContain('license_number#0')
  })
})
