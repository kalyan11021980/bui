import { describe, it, expect } from 'vitest'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
import type { Action } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const profile: ApplicantProfile = {
  applicantType: 'individual',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: [],
}

const AT = '2026-08-01T12:00:00.000Z'

describe('applicationReducer', () => {
  it('starts with every required field outstanding', () => {
    const s = createApplication('app-1', profile)
    expect(outstandingFields(s).length).toBeGreaterThan(0)
    expect(isComplete(s)).toBe(false)
  })

  it('records a value with its provenance', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT, confidence: 0.97, documentId: 'doc-1',
    })
    expect(s.fields.first_name?.value).toBe('Kalyan')
    expect(s.fields.first_name?.status).toBe('derived')
    expect(s.fields.first_name?.provenance?.source).toBe('ocr')
    expect(s.fields.first_name?.provenance?.confidence).toBe(0.97)
  })

  it('marks a user-entered value confirmed immediately', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(s.fields.first_name?.status).toBe('confirmed')
  })

  it('moves a derived field to confirmed when the user confirms it', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'dob', value: '1982-08-31',
      source: 'ocr', at: AT,
    })
    s = applicationReducer(s, {
      type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'abc123',
    })
    expect(s.fields.dob?.status).toBe('confirmed')
  })

  it('refuses to confirm a field that has no value', () => {
    const s = createApplication('app-1', profile)
    expect(() =>
      applicationReducer(s, {
        type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'abc',
      }),
    ).toThrow(/no value/i)
  })

  it('rejects a field with a human-readable reason', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'id_images', value: ['img-1'],
      source: 'user', at: AT,
    })
    s = applicationReducer(s, {
      type: 'REJECT', fieldId: 'id_images', at: AT,
      reason: 'The photo was too dark to read your license number',
    })
    expect(s.fields.id_images?.status).toBe('rejected')
    expect(s.fields.id_images?.rejection?.reason).toMatch(/too dark/)
  })

  it('leaves other verified fields untouched when one is rejected', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    s = applicationReducer(s, { type: 'VERIFY', fieldId: 'first_name', at: AT })
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'id_images', value: ['img-1'],
      source: 'user', at: AT,
    })
    s = applicationReducer(s, {
      type: 'REJECT', fieldId: 'id_images', at: AT, reason: 'Too dark',
    })
    expect(s.fields.first_name?.status).toBe('verified')
  })

  it('counts a rejected field as outstanding again', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'id_images', value: ['img-1'],
      source: 'user', at: AT,
    })
    expect(outstandingFields(s)).not.toContain('id_images')
    s = applicationReducer(s, {
      type: 'REJECT', fieldId: 'id_images', at: AT, reason: 'Too dark',
    })
    expect(outstandingFields(s)).toContain('id_images')
  })

  it('is complete only when every required field is confirmed or verified', () => {
    let s = createApplication('app-1', profile)
    for (const id of outstandingFields(s)) {
      s = applicationReducer(s, {
        type: 'SET_VALUE', fieldId: id, value: 'x', source: 'user', at: AT,
      })
    }
    expect(isComplete(s)).toBe(true)
  })

  it('never mutates the state or its nested field objects', () => {
    let seeded = createApplication('app-1', profile)
    seeded = applicationReducer(seeded, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT, confidence: 0.9,
    })
    const originalField = seeded.fields.first_name
    const originalProvenance = originalField?.provenance
    const snapshot = JSON.stringify(seeded)

    const actions: readonly Action[] = [
      { type: 'CONFIRM', fieldId: 'first_name', at: AT, shownCopyHash: 'c1' },
      { type: 'VERIFY', fieldId: 'first_name', at: AT },
      { type: 'REJECT', fieldId: 'first_name', at: AT, reason: 'Too dark' },
      { type: 'SUPERSEDE', fieldId: 'first_name', at: AT },
      {
        type: 'SET_VALUE', fieldId: 'first_name', value: 'Other',
        source: 'user', at: AT,
      },
    ]

    for (const action of actions) {
      const next = applicationReducer(seeded, action)
      expect(next).not.toBe(seeded)
      expect(next.fields.first_name).not.toBe(originalField)
      expect(JSON.stringify(seeded), action.type).toBe(snapshot)
    }

    // the nested provenance object must survive by reference too
    expect(seeded.fields.first_name?.provenance).toBe(originalProvenance)
  })
})
