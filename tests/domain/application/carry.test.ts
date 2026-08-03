import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import {
  applyCarry, carriedFrom, carryNotice, CARRY_RULES,
} from '@/domain/application/carry'
import { requiredFields } from '@/domain/requirements/engine'
import type { ApplicantProfile, LicenseType } from '@/domain/requirements/rules'

const AT = '2026-08-01T12:00:00.000Z'
const business: ApplicantProfile = {
  applicantType: 'business',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: ['dealer'],
  addressDiffersFromId: false,
  idForm: 'drivers_license',
}

function withAddress() {
  let s = createApplication('app-1', business)
  for (const [id, v] of [
    ['addr_line1', '2345 Anywhere St'],
    ['addr_city', 'Atlanta'],
    ['addr_state', 'GA'],
    ['addr_zip', '30301'],
  ] as const) {
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: id, value: v, source: 'user', at: AT,
    })
  }
  return s
}

describe('applyCarry', () => {
  it('carries the personal address into the business address', () => {
    const s = applyCarry(withAddress(), AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
    expect(s.fields.biz_addr_city?.value).toBe('Atlanta')
    expect(s.fields.biz_addr_zip?.value).toBe('30301')
  })

  it('marks carried values as derived, not confirmed', () => {
    const s = applyCarry(withAddress(), AT).state
    expect(s.fields.biz_addr_line1?.status).toBe('derived')
  })

  it('records where a carried value came from', () => {
    const s = applyCarry(withAddress(), AT).state
    expect(s.fields.biz_addr_line1?.provenance?.source).toBe('carried')
    expect(s.fields.biz_addr_line1?.provenance?.fromFieldId).toBe('addr_line1')
    expect(carriedFrom(s, 'biz_addr_line1')).toBe('addr_line1')
  })

  it('never overwrites a value the user already gave', () => {
    let s = withAddress()
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'biz_addr_city', value: 'Savannah',
      source: 'user', at: AT,
    })
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_city?.value).toBe('Savannah')
    expect(s.fields.biz_addr_city?.status).toBe('confirmed')
  })

  it('does nothing when the source field is empty', () => {
    const s = applyCarry(createApplication('app-1', business), AT).state
    expect(s.fields.biz_addr_line1).toBeUndefined()
  })

  it('returns null from carriedFrom for a directly-entered field', () => {
    const s = withAddress()
    expect(carriedFrom(s, 'addr_line1')).toBeNull()
  })

  it('returns the actions it applied, so the caller can audit them', () => {
    // Without this, a carried value lands in the applicant's record with no
    // trail entry — the route only ever audited the action it was handed.
    const { applied } = applyCarry(withAddress(), AT)
    expect(applied.length).toBeGreaterThan(0)
    for (const action of applied) {
      expect(action.type).toBe('SET_VALUE')
      if (action.type !== 'SET_VALUE') throw new Error('unreachable')
      expect(action.source).toBe('carried')
      expect(action.fromFieldId).toBeTruthy()
      expect(action.at).toBe(AT)
    }
    expect(applied.map((a) => 'fieldId' in a && a.fieldId))
      .toEqual(['biz_addr_line1', 'biz_addr_city', 'biz_addr_state', 'biz_addr_zip'])
  })

  it('reports nothing applied when there was nothing to carry', () => {
    expect(applyCarry(createApplication('app-1', business), AT).applied).toEqual([])
  })

  it('never carries into a field this applicant is not asked for', () => {
    // An individual is never asked for a business address. Carrying into one
    // anyway puts fields in the record that the panel cannot show and the
    // route's requirements check would refuse.
    const individual: ApplicantProfile = { ...business, applicantType: 'individual' }
    let s = createApplication('app-1', individual)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'addr_line1', value: '2345 Anywhere St',
      source: 'user', at: AT,
    })
    const result = applyCarry(s, AT)
    expect(result.applied).toEqual([])
    expect(result.state.fields.biz_addr_line1).toBeUndefined()
  })

  it('does not overwrite a destination that OCR already filled', () => {
    let s = withAddress()
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'biz_addr_city', value: 'Macon',
      source: 'ocr', at: AT, confidence: 0.94,
    })
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_city?.value).toBe('Macon')
    expect(s.fields.biz_addr_city?.provenance?.source).toBe('ocr')
  })
})

/**
 * Every key the requirements engine can emit, for any profile it can be
 * given. A carry rule naming anything outside this set is dead: it reads
 * like working redundancy-removal and does nothing.
 */
function everyEmittableKey(): Set<string> {
  const licenceSets: readonly (readonly LicenseType[])[] = [
    [], ['dealer'], ['dealer', 'salvage'], ['dismantler', 'exporter', 'salvage'],
  ]
  const idForms = ['drivers_license', 'state_id', 'passport'] as const
  const keys = new Set<string>()
  for (const applicantType of ['individual', 'business'] as const) {
    for (const wantsGsa of [false, true]) {
      for (const state of [null, 'GA', 'OH', 'ZZ']) {
        for (const licenses of licenceSets) {
          // Both declarations are swept too: pinning either would report a
          // rule naming id_number or proof_of_residency as dead.
          for (const idForm of idForms) {
            for (const addressDiffersFromId of [false, true]) {
              const profile: ApplicantProfile = {
                applicantType, country: 'US', state, wantsGsa, licenses,
                addressDiffersFromId, idForm,
              }
              for (const key of requiredFields(profile)) keys.add(key)
            }
          }
        }
      }
    }
  }
  return keys
}

describe('CARRY_RULES agree with the requirements engine', () => {
  it('names only sources the engine can actually emit for some profile', () => {
    // This is the test that would have caught the drift. Two of six rules
    // pointed at keys no profile ever produces: `addr_line2` (optional, so
    // never required) and `phone_primary` (CORE_CONTACT is phone_mobile
    // only). Neither could ever fire.
    const emittable = everyEmittableKey()
    for (const rule of CARRY_RULES) {
      expect(emittable.has(rule.from), `no profile ever asks for ${rule.from}`).toBe(true)
    }
  })

  it('names only destinations the engine can actually emit for some profile', () => {
    const emittable = everyEmittableKey()
    for (const rule of CARRY_RULES) {
      expect(emittable.has(rule.to), `no profile ever asks for ${rule.to}`).toBe(true)
    }
  })

  it('never carries a value into the field it came from', () => {
    for (const rule of CARRY_RULES) expect(rule.from).not.toBe(rule.to)
  })

  it('gives each destination exactly one source', () => {
    const destinations = CARRY_RULES.map((r) => r.to)
    expect(new Set(destinations).size).toBe(destinations.length)
  })

  it('carries the mobile phone into the business phone — the redundancy the spec names', () => {
    // biz_phone is required of every business and had no working carry: the
    // rule pointed at phone_primary, which is never collected.
    let s = createApplication('app-1', business)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'phone_mobile', value: '4045551234',
      source: 'user', at: AT,
    })
    const { state, applied } = applyCarry(s, AT)
    expect(state.fields.biz_phone?.value).toBe('4045551234')
    expect(state.fields.biz_phone?.provenance?.fromFieldId).toBe('phone_mobile')
    expect(applied.some((a) => 'fieldId' in a && a.fieldId === 'biz_phone')).toBe(true)
  })
})

describe('a carried value tracks its source until the applicant owns it', () => {
  function setAddress(s: ReturnType<typeof createApplication>, value: string) {
    return applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'addr_line1', value, source: 'user', at: AT,
    })
  }

  it('refreshes an unconfirmed carried value when the source changes', () => {
    // Found by driving the real UI: typing an address a character at a time
    // carried the first keystroke and never refreshed, leaving the applicant
    // with a business address reading "2".
    let s = setAddress(createApplication('app-1', business), '2')
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('2')

    s = setAddress(s, '2345 Anywhere St')
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
  })

  it('leaves a stale carried value nowhere for a correction to hide', () => {
    // The quieter version of the same bug over the API: correcting a home
    // address left the old one mirrored into the business address, and a
    // plausible stale value is exactly what gets rubber-stamped.
    let s = setAddress(createApplication('app-1', business), '2345 Anywhere St')
    s = applyCarry(s, AT).state
    s = setAddress(s, '99 Other Rd')
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('99 Other Rd')
  })

  it('stops refreshing once the applicant has confirmed the carried value', () => {
    let s = setAddress(createApplication('app-1', business), '2345 Anywhere St')
    s = applyCarry(s, AT).state
    s = applicationReducer(s, {
      type: 'CONFIRM', fieldId: 'biz_addr_line1', at: AT, shownCopyHash: 'c1',
    })

    s = setAddress(s, '99 Other Rd')
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
    expect(s.fields.biz_addr_line1?.status).toBe('confirmed')
  })

  it('stops refreshing once the applicant has typed their own value', () => {
    let s = setAddress(createApplication('app-1', business), '2345 Anywhere St')
    s = applyCarry(s, AT).state
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'biz_addr_line1', value: '1 Dealership Way',
      source: 'user', at: AT,
    })

    s = setAddress(s, '99 Other Rd')
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('1 Dealership Way')
  })

  it('does nothing when the source has not changed', () => {
    let s = setAddress(createApplication('app-1', business), '2345 Anywhere St')
    s = applyCarry(s, AT).state
    const second = applyCarry(s, AT)
    expect(second.applied).toEqual([])
    expect(second.state).toBe(s)
  })

  it('still refuses to overwrite a value OCR supplied', () => {
    let s = setAddress(createApplication('app-1', business), '2345 Anywhere St')
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'biz_addr_line1', value: 'Macon Rd',
      source: 'ocr', at: AT, confidence: 0.94,
    })
    s = applyCarry(s, AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('Macon Rd')
    expect(s.fields.biz_addr_line1?.provenance?.source).toBe('ocr')
  })
})

describe('carryNotice', () => {
  it('names what the edit filled in elsewhere', () => {
    const result = applyCarry(withAddress(), AT)
    const notice = carryNotice('addr_line1', result.applied)

    expect(notice?.from).toBe('addr_line1')
    // Every destination carry actually wrote, so the row the applicant typed
    // into can say so where their eyes already are — not 600px below the fold.
    expect(notice?.filled).toEqual([
      'biz_addr_line1', 'biz_addr_city', 'biz_addr_state', 'biz_addr_zip',
    ])
  })

  it('says nothing when the edit saved the applicant nothing', () => {
    // An acknowledgement on every keystroke regardless is noise, and noise is
    // what people learn to stop reading.
    expect(carryNotice('first_name', [])).toBeNull()
  })

  it('says nothing on a re-run that carried nothing new', () => {
    const settled = applyCarry(withAddress(), AT).state
    expect(carryNotice('addr_line1', applyCarry(settled, AT).applied)).toBeNull()
  })
})

describe('carry and a cleared source', () => {
  it('clears an unconfirmed mirror when its source goes away', () => {
    // Otherwise correcting a home address by clearing it leaves a plausible
    // business address behind with nothing backing it — a stale carried value
    // is exactly what gets rubber-stamped.
    let s = applyCarry(withAddress(), AT).state
    expect(s.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')

    s = applicationReducer(s, { type: 'CLEAR_VALUE', fieldId: 'addr_line1', at: AT })
    const result = applyCarry(s, AT)

    expect(result.state.fields.biz_addr_line1?.value).toBeNull()
    expect(result.applied).toContainEqual({
      type: 'CLEAR_VALUE', fieldId: 'biz_addr_line1', at: AT,
    })
    // Only the mirror of the cleared source. The others still have theirs.
    expect(result.state.fields.biz_addr_city?.value).toBe('Atlanta')
  })

  it('leaves a business address the applicant made their own alone', () => {
    let s = applyCarry(withAddress(), AT).state
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'biz_addr_line1', value: '1 Dealership Way',
      source: 'user', at: AT,
    })
    s = applicationReducer(s, { type: 'CLEAR_VALUE', fieldId: 'addr_line1', at: AT })

    const result = applyCarry(s, AT)
    expect(result.state.fields.biz_addr_line1?.value).toBe('1 Dealership Way')
    expect(result.applied).toEqual([])
  })

  it('reports what it cleared, so the applicant is told', () => {
    let s = applyCarry(withAddress(), AT).state
    s = applicationReducer(s, { type: 'CLEAR_VALUE', fieldId: 'addr_zip', at: AT })
    const notice = carryNotice('addr_zip', applyCarry(s, AT).applied)

    expect(notice?.filled).toEqual([])
    expect(notice?.cleared).toEqual(['biz_addr_zip'])
  })

  it('clears nothing twice', () => {
    let s = applyCarry(withAddress(), AT).state
    s = applicationReducer(s, { type: 'CLEAR_VALUE', fieldId: 'addr_line1', at: AT })
    s = applyCarry(s, AT).state
    const second = applyCarry(s, AT)
    expect(second.applied).toEqual([])
    expect(second.state).toBe(s)
  })
})

describe('everyEmittableKey sweeps the whole profile', () => {
  it('reaches the keys only a non-default declaration produces', () => {
    // Guards the guard. Pinning idForm or addressDiffersFromId narrows the
    // set silently, and the two tests above then report a live carry rule as
    // dead — a finding that reads like drift and is not.
    const emittable = everyEmittableKey()
    for (const key of [
      'dl_number', 'id_number', 'passport_number', 'proof_of_residency',
    ]) {
      expect(emittable.has(key), `no profile in the sweep asks for ${key}`).toBe(true)
    }
  })
})
