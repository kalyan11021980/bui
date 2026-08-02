import { describe, it, expect } from 'vitest'
import { STATE_RULES } from '@/domain/requirements/rules'
import { CATALOG } from '@/domain/catalog'

/**
 * `signedOff` is read by nothing at runtime, so an un-reviewed encoding of a
 * state's licensing law is indistinguishable from a reviewed one. The
 * sign-off itself is a compliance owner's job (§10.3) and stays parked; what
 * belongs in code is a list that cannot quietly change.
 *
 * If you are here because this test failed, you have either added a state
 * rule or signed one off. Edit the list — deliberately.
 */
const UNSIGNED_STATE_RULES: readonly string[] = ['GA', 'OH']

describe('STATE_RULES sign-off (spec §10.3)', () => {
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
