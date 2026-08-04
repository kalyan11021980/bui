import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { uploadedDocTypes } from '@/domain/application/documents'
import type { ApplicationState } from '@/domain/application/state'

const AT = '2026-08-04T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}
const fresh = (): ApplicationState => createApplication('app-1', PROFILE, 'tok')

const record = (documentId: string, docType: 'drivers_license' | 'passport') =>
  ({ type: 'RECORD_DOCUMENT' as const, documentId, docType, at: AT })

describe('recorded documents', () => {
  it('starts empty', () => {
    expect(fresh().documents).toEqual([])
    expect(uploadedDocTypes(fresh())).toEqual([])
  })

  it('records the type alongside the id', () => {
    const state = applicationReducer(fresh(), record('doc-1', 'drivers_license'))
    expect(state.documents).toEqual([
      { documentId: 'doc-1', docType: 'drivers_license', at: AT },
    ])
    expect(uploadedDocTypes(state)).toEqual(['drivers_license'])
  })

  it('deduplicates types across several uploads of the same kind', () => {
    let state = applicationReducer(fresh(), record('doc-1', 'drivers_license'))
    state = applicationReducer(state, record('doc-2', 'drivers_license'))
    expect(state.documents).toHaveLength(2)
    expect(uploadedDocTypes(state)).toEqual(['drivers_license'])
  })

  it('refuses a duplicate documentId rather than recording it twice', () => {
    const state = applicationReducer(fresh(), record('doc-1', 'passport'))
    expect(() => applicationReducer(state, record('doc-1', 'passport')))
      .toThrow(/doc-1/)
  })

  it('refuses once submitted, like every other action', () => {
    const submitted = { ...fresh(), submittedAt: AT }
    expect(() => applicationReducer(submitted, record('doc-1', 'passport'))).toThrow()
  })
})
