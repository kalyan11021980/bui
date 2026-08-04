import { describe, it, expect } from 'vitest'
import { toOrchestratorView } from '@/domain/orchestrator/view'
import { createApplication } from '@/domain/application/reducer'
import { applicationReducer } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'

function seeded(): ApplicationState {
  const base = createApplication('app-1', {
    applicantType: 'individual', country: 'US', state: 'GA',
    wantsGsa: false, licenses: [], addressDiffersFromId: false,
    idForm: 'drivers_license',
  }, 'tok')
  return applicationReducer(base, {
    type: 'SET_VALUE', fieldId: 'tax_id', value: '123456789',
    source: 'user', at: '2026-08-03T00:00:00.000Z',
  })
}

describe('toOrchestratorView', () => {
  it('never carries a sensitive field value', () => {
    const view = toOrchestratorView(seeded(), [])
    const serialised = JSON.stringify(view)
    expect(serialised).not.toContain('123456789')
  })

  it('carries the field id, label and status for a sensitive field', () => {
    const view = toOrchestratorView(seeded(), [])
    const all = [...view.outstanding, ...view.settled]
    const taxId = all.find((f) => f.id === 'tax_id')
    expect(taxId).toBeDefined()
    expect(taxId?.sensitive).toBe(true)
    expect(taxId?.status).toBe('confirmed')
    expect(taxId?.value).toBeUndefined()
  })

  it('carries the value only for an orchestratorVisible field', () => {
    // first_name is the allowlisted display value; see the catalog.
    let state = applicationReducer(seeded(), {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: '2026-08-03T00:00:00.000Z',
    })
    // last_name is non-sensitive but NOT allowlisted: distinguishes "visible"
    // from merely "not sensitive", which sensitive-only fields cannot.
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: 'last_name', value: 'Menon',
      source: 'user', at: '2026-08-03T00:00:00.000Z',
    })
    const view = toOrchestratorView(state, [])
    const all = [...view.outstanding, ...view.settled]
    expect(all.find((f) => f.id === 'first_name')?.value).toBe('Kalyan')
    expect(all.find((f) => f.id === 'last_name')?.value).toBeUndefined()
  })

  it('splits outstanding from settled by the same rule the panel uses', () => {
    const view = toOrchestratorView(seeded(), [])
    expect(view.outstanding.every((f) => f.status !== 'confirmed')).toBe(true)
    expect(view.settled.some((f) => f.id === 'tax_id')).toBe(true)
  })

  it('omits documents already uploaded', () => {
    const view = toOrchestratorView(seeded(), ['drivers_license'])
    expect(view.documentsOutstanding).not.toContain('drivers_license')
  })

  it('throws on a stored field with no catalog entry rather than assuming it is safe', () => {
    const broken = seeded()
    const rogue = { ...broken, fields: { ...broken.fields, not_a_field: { value: 'x', status: 'confirmed' as const } } }
    expect(() => toOrchestratorView(rogue, [])).toThrow(/not_a_field/)
  })
})
