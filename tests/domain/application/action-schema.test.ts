import { describe, it, expect } from 'vitest'
import {
  actionSchema, describeZodError, requestBodySchema, toAction,
} from '@/domain/application/action-schema'

const AT = '2026-08-01T12:00:00.000Z'

describe('actionSchema', () => {
  it('accepts each well-formed action type', () => {
    const cases: unknown[] = [
      { type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT },
      { type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'copy-v1' },
      { type: 'VERIFY', fieldId: 'dob', at: AT },
      { type: 'REJECT', fieldId: 'id_images', at: AT, reason: 'too dark' },
      { type: 'SUPERSEDE', fieldId: 'license_number#1', at: AT },
      { type: 'UPDATE_PROFILE', patch: { applicantType: 'business' }, at: AT },
    ]
    for (const c of cases) {
      expect(actionSchema.safeParse(c).success, JSON.stringify(c)).toBe(true)
    }
  })

  it('rejects an action type it has never heard of', () => {
    expect(actionSchema.safeParse({ type: 'DELETE_EVERYTHING', at: AT }).success).toBe(false)
  })

  it('rejects a stray property rather than silently dropping it', () => {
    const r = actionSchema.safeParse({
      type: 'VERIFY', fieldId: 'dob', at: AT, sudo: true,
    })
    expect(r.success).toBe(false)
  })

  it('rejects a profile patch key the engine does not read', () => {
    expect(actionSchema.safeParse({
      type: 'UPDATE_PROFILE', patch: { applicantTyp: 'business' }, at: AT,
    }).success).toBe(false)
  })

  it('rejects a licence type outside the four the rules define', () => {
    expect(actionSchema.safeParse({
      type: 'UPDATE_PROFILE', patch: { licenses: ['forklift'] }, at: AT,
    }).success).toBe(false)
  })

  it('rejects a provenance source outside the four the state defines', () => {
    expect(actionSchema.safeParse({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'psychic', at: AT,
    }).success).toBe(false)
  })

  it('requires an id on the request body', () => {
    expect(requestBodySchema.safeParse({
      action: { type: 'VERIFY', fieldId: 'dob', at: AT },
    }).success).toBe(false)
    expect(requestBodySchema.safeParse({
      id: '', action: { type: 'VERIFY', fieldId: 'dob', at: AT },
    }).success).toBe(false)
  })
})

describe('toAction', () => {
  it('omits absent optionals entirely rather than setting them undefined', () => {
    // exactOptionalPropertyTypes draws a line between "absent" and "present
    // and undefined"; a spread-through would put `documentId: undefined` into
    // provenance as a real key.
    const parsed = actionSchema.parse({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT,
    })
    const action = toAction(parsed)
    expect(Object.keys(action).sort()).toEqual(['at', 'fieldId', 'source', 'type', 'value'])
  })

  it('keeps optionals that were actually supplied', () => {
    const parsed = actionSchema.parse({
      type: 'SET_VALUE', fieldId: 'dob', value: '1982-08-31', source: 'ocr', at: AT,
      documentId: 'doc-1', confidence: 0.96, box: [1, 2, 3, 4],
    })
    const action = toAction(parsed)
    expect(action).toMatchObject({ documentId: 'doc-1', confidence: 0.96, box: [1, 2, 3, 4] })
  })

  it('carries a profile patch through with only the keys that were sent', () => {
    const parsed = actionSchema.parse({
      type: 'UPDATE_PROFILE', patch: { wantsGsa: true }, at: AT,
    })
    const action = toAction(parsed)
    expect(action.type).toBe('UPDATE_PROFILE')
    if (action.type !== 'UPDATE_PROFILE') throw new Error('unreachable')
    expect(Object.keys(action.patch)).toEqual(['wantsGsa'])
  })

  it('allows state to be set back to null', () => {
    const parsed = actionSchema.parse({
      type: 'UPDATE_PROFILE', patch: { state: null }, at: AT,
    })
    const action = toAction(parsed)
    if (action.type !== 'UPDATE_PROFILE') throw new Error('unreachable')
    expect(action.patch.state).toBeNull()
  })
})

describe('describeZodError', () => {
  it('names the offending path so the caller can act on it', () => {
    const r = actionSchema.safeParse({
      type: 'REJECT', fieldId: 'dob', at: AT, reason: '',
    })
    expect(r.success).toBe(false)
    if (r.success) throw new Error('unreachable')
    expect(describeZodError(r.error)).toMatch(/reason/)
  })
})
