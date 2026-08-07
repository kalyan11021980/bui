import { describe, it, expect } from 'vitest'
import { ALL_PROFILE_KEYS, ID_NUMBER, STATE_RULES, isUnitedStates } from '@/domain/requirements/rules'
import { RULES_VERSION } from '@/domain/requirements/version'
import { CATALOG } from '@/domain/catalog'

/**
 * `signedOff` is read by nothing at runtime, so an un-reviewed encoding of a
 * state's licensing law is indistinguishable from a reviewed one. The
 * sign-off itself is a compliance owner's job and stays parked; what
 * belongs in code is a list that cannot quietly change.
 *
 * If you are here because this test failed, you have either added a state
 * rule or signed one off. Edit the list — deliberately.
 */
const UNSIGNED_STATE_RULES: readonly string[] = ['GA', 'OH']

describe('what an applicant owes, by document', () => {
  it('gives each form of ID exactly one number field, and no two the same', () => {
    const fields = Object.values(ID_NUMBER)
    expect(new Set(fields).size).toBe(fields.length)
    expect(ID_NUMBER).toEqual({
      drivers_license: 'dl_number',
      state_id: 'id_number',
      passport: 'passport_number',
    })
  })

  it('is at the rules version these rules were last changed under', () => {
    // If you are here because this failed, `rules.ts` changed what an
    // applicant owes and the version has to move with it — deliberately.
    expect(RULES_VERSION).toBe(4)
  })
})

describe('STATE_RULES sign-off', () => {
  it('has exactly these rules still awaiting a compliance sign-off', () => {
    const unsigned = Object.entries(STATE_RULES)
      .filter(([, rule]) => !rule.signedOff)
      .map(([code]) => code)
      .sort()
    expect(unsigned).toEqual([...UNSIGNED_STATE_RULES].sort())
  })

  it('states plainly that NO state rule has been signed off yet', () => {
    // Phase 1 ships with none reviewed. When the first one is signed off both
    // this assertion and the list above have to be edited on purpose.
    expect(Object.values(STATE_RULES).every((r) => r.signedOff)).toBe(false)
    expect(Object.values(STATE_RULES).some((r) => r.signedOff)).toBe(false)
  })

  it('gives every state rule a note a compliance reviewer can check', () => {
    for (const [code, rule] of Object.entries(STATE_RULES)) {
      expect(rule.note.trim(), `${code} has no note to review`).not.toBe('')
    }
  })

  it('references only fields that exist in the catalog', () => {
    // A state rule naming a field the catalog lacks would make an applicant
    // in that state permanently incompletable.
    for (const [code, rule] of Object.entries(STATE_RULES)) {
      for (const id of rule.additional) {
        expect(CATALOG.has(id), `${code} requires unknown field ${id}`).toBe(true)
      }
    }
  })

  it('keys the table by upper-case two-letter codes, as the engine assumes', () => {
    for (const code of Object.keys(STATE_RULES)) {
      expect(code).toMatch(/^[A-Z]{2}$/)
    }
  })
})

describe('bizCountry', () => {
  it('is a listed profile key', () => {
    expect(ALL_PROFILE_KEYS).toContain('bizCountry')
  })
})

describe('isUnitedStates', () => {
  it('accepts null, US and USA; rejects others', () => {
    expect(isUnitedStates(null)).toBe(true)
    expect(isUnitedStates('US')).toBe(true)
    expect(isUnitedStates('USA')).toBe(true)
    expect(isUnitedStates('CAN')).toBe(false)
  })
})
