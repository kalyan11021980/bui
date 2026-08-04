import { describe, it, expect } from 'vitest'
import { guardToolCall } from '@/domain/orchestrator/guard'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { requiredFields } from '@/domain/requirements/engine'

const AT = '2026-08-03T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }

function reject(
  call: Parameters<typeof guardToolCall>[0],
  state = fresh(),
  docs: readonly DocType[] = [],
) {
  const outcome = guardToolCall(call, state, docs, AT)
  if (outcome.ok) throw new Error(`expected a rejection, got ${JSON.stringify(outcome)}`)
  return outcome.code
}

describe('guardToolCall rejections', () => {
  it('rejects an empty askFor', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: [] } })).toBe('ask_cardinality')
  })

  it('rejects an askFor of more than four fields', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['a','b','c','d','e'] } }))
      .toBe('ask_cardinality')
  })

  it('rejects a field that is not outstanding', () => {
    let state = fresh()
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'K', source: 'user', at: AT,
    })
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name'] } }, state))
      .toBe('field_not_outstanding')
  })

  it('rejects a field with no catalog entry', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['not_a_field'] } }))
      .toBe('unknown_field')
  })

  it('rejects a malformed requirement key', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name#x'] } }))
      .toBe('unknown_field')
  })

  it('rejects duplicate ids in one ask', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name', 'first_name'] } }))
      .toBe('duplicate_field')
  })

  it('rejects the whole ask when one id is bad, with no partial block for the good one', () => {
    const outcome = guardToolCall(
      { toolName: 'askFor', input: { fieldIds: ['first_name', 'not_a_field'] } },
      fresh(), [], AT,
    )
    // toEqual over the whole outcome, not just `.code`: an `ok: false` result
    // that also carried a `blocks` entry for `first_name` would pass a
    // code-only assertion while still leaking the field that should have
    // been refused along with the rest of the call.
    expect(outcome).toEqual({ ok: false, code: 'unknown_field' })
  })

  it('rejects a patch the panel schema would refuse', () => {
    expect(reject({ toolName: 'setProfile', input: { patch: { nonsense: true } } }))
      .toBe('malformed_patch')
  })

  it('rejects an empty patch', () => {
    expect(reject({ toolName: 'setProfile', input: { patch: {} } })).toBe('empty_patch')
  })

  it('rejects a document this applicant does not owe', () => {
    expect(reject({ toolName: 'requestDocument', input: { docType: 'proof_of_residency' } }))
      .toBe('document_not_required')
  })

  it('rejects a document already uploaded', () => {
    expect(reject(
      { toolName: 'requestDocument', input: { docType: 'drivers_license' } },
      fresh(), ['drivers_license'],
    )).toBe('document_already_held')
  })

  it('rejects everything once submitted', () => {
    const submitted = { ...fresh(), submittedAt: AT }
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name'] } }, submitted))
      .toBe('application_closed')
  })

  it('rejects a tool outside the five', () => {
    expect(reject({ toolName: 'setValue', input: { fieldId: 'tax_id', value: '1' } }))
      .toBe('unknown_tool')
  })

  // Table row not covered above: explain on an id the catalog has never
  // heard of. This never reaches the outstanding-or-settled check below —
  // it is refused earlier, by the same `knownField` gate `askFor` uses.
  it('rejects an explain for a field with no catalog entry', () => {
    expect(reject({ toolName: 'explain', input: { fieldId: 'not_a_field' } }))
      .toBe('unknown_field')
  })

  // Distinct from the row above: a real catalog field that this profile does
  // not owe and has never recorded. `tax_id` is only required of a business
  // applicant; PROFILE here is an individual. Only this case reaches the
  // outstanding-or-settled check — `not_a_field` above never gets that far.
  it('rejects an explain for a field this profile does not require and has not recorded', () => {
    expect(reject({ toolName: 'explain', input: { fieldId: 'tax_id' } }))
      .toBe('unknown_field')
  })

  // The closed check must run before tool-name resolution, not just before
  // the tool-specific business rules — otherwise a submitted application
  // would leak `unknown_tool` (or any other code) for a call that should be
  // refused outright, whatever it names.
  it('rejects an unrecognised tool name on a submitted application as closed, not unknown_tool', () => {
    const submitted = { ...fresh(), submittedAt: AT }
    expect(reject({ toolName: 'setValue', input: {} }, submitted)).toBe('application_closed')
  })

  // Same requirement, checked against schema parsing rather than name
  // resolution: a malformed payload on a submitted application must still
  // read as closed, not as a parse failure.
  it('rejects a malformed payload on a submitted application as closed, not malformed_patch', () => {
    const submitted = { ...fresh(), submittedAt: AT }
    expect(reject(
      { toolName: 'setProfile', input: { patch: { nonsense: true } } }, submitted,
    )).toBe('application_closed')
  })
})

describe('guardToolCall acceptance', () => {
  it('accepts an ask for an outstanding field and produces a block', () => {
    const outcome = guardToolCall(
      { toolName: 'askFor', input: { fieldIds: ['first_name'] } }, fresh(), [], AT,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.blocks).toEqual([{ kind: 'field_ask', fieldId: 'first_name' }])
    expect(outcome.actions).toEqual([])
  })

  it('turns setProfile into an UPDATE_PROFILE action', () => {
    const outcome = guardToolCall(
      { toolName: 'setProfile', input: { patch: { state: 'OH' } } }, fresh(), [], AT,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.actions).toEqual([
      { type: 'UPDATE_PROFILE', patch: { state: 'OH' }, at: AT },
    ])
  })

  it('accepts an explain for an outstanding field and produces a rationale block', () => {
    const outcome = guardToolCall(
      { toolName: 'explain', input: { fieldId: 'first_name' } }, fresh(), [], AT,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.blocks).toEqual([{ kind: 'rationale', fieldId: 'first_name' }])
  })

  it('orients a fresh application at zero of the full requirement count', () => {
    const outcome = guardToolCall({ toolName: 'orient', input: {} }, fresh(), [], AT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.blocks).toEqual([
      { kind: 'orientation', done: 0, total: requiredFields(PROFILE).length },
    ])
  })

  it('counts a derived (unconfirmed) field as still outstanding, not done', () => {
    let state = fresh()
    // Confirmed: typed by the applicant, satisfies the requirement.
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'K', source: 'user', at: AT,
    })
    // Derived: read off a document but not yet confirmed — still outstanding,
    // and must not inflate `total` by also being counted as a raw field.
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: 'last_name', value: 'L', source: 'ocr', at: AT,
    })
    const outcome = guardToolCall({ toolName: 'orient', input: {} }, state, [], AT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.blocks).toEqual([
      { kind: 'orientation', done: 1, total: requiredFields(PROFILE).length },
    ])
  })
})
