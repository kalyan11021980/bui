import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { applyCarry, carriedFrom } from '@/domain/application/carry'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const AT = '2026-08-01T12:00:00.000Z'
const business: ApplicantProfile = {
  applicantType: 'business',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: ['dealer'],
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
    // route's §8.2 check would refuse.
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
