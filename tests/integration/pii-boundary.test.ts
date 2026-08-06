import { describe, it, expect, beforeEach } from 'vitest'
import { ALL_FIELDS } from '@/domain/catalog'
import { toOrchestratorView, type FieldView } from '@/domain/orchestrator/view'
import { runTurn } from '@/server/orchestrator/service'
import { createApplication } from '@/domain/application/reducer'
import { requiredFields } from '@/domain/requirements/engine'
import { reqKey, parseReqKey } from '@/domain/requirements/key'
import type { ApplicationState } from '@/domain/application/state'
import { stubModel } from '../server/orchestrator/stub-model'

const AT = '2026-08-03T00:00:00.000Z'

/** Distinctive per field, so a leak names the field that leaked. */
const valueFor = (id: string) => `VALUE_FOR_${id}`

/**
 * Every required field the profile owes, each carrying its own marker, in
 * `derived` (entered, unconfirmed) status. Only outstanding fields keep a
 * `value` past the prompt builder — a `confirmed` field is settled and
 * stripped to its id before the model ever sees it, which would make every
 * case below pass whether or not the redaction gate works. Values that a
 * field's own schema would reject are irrelevant here: the state is built by
 * hand, not the reducer, and this test is about transmission, not validation.
 */
function everythingFilled(): ApplicationState {
  let state = createApplication('app-1', {
    applicantType: 'business', country: 'US', state: 'GA', wantsGsa: true,
    licenses: ['dealer'], addressDiffersFromId: true, idForm: 'drivers_license',
  }, 'tok')
  const required = new Set(requiredFields(state.profile))
  for (const def of ALL_FIELDS) {
    // Licence fields are owed once per licence held, under `<id>#0`, not the
    // bare catalog id.
    const key = required.has(reqKey(def.id, 0)) ? reqKey(def.id, 0) : def.id
    state = {
      ...state,
      fields: {
        ...state.fields,
        [key]: { value: valueFor(def.id), status: 'derived' },
      },
    }
  }
  return state
}

/** Everything the SDK would send: system prompt, messages, tool schemas. */
async function capturedPayload(state: ApplicationState): Promise<string> {
  const model = stubModel('Right.', [])
  await runTurn({
    model,
    view: toOrchestratorView(state, []),
    state, transcript: [], uploadedDocs: [], userText: null,
    isResume: false, at: AT, effort: 'low', isAnthropic: false, doneWith: null,
  })
  expect(model.doGenerateCalls.length).toBe(1)
  return JSON.stringify(model.doGenerateCalls[0])
}

describe('no field value reaches the model', () => {
  let payload: string
  let outstanding: readonly FieldView[]
  let fields: ApplicationState['fields']

  beforeEach(async () => {
    const state = everythingFilled()
    outstanding = toOrchestratorView(state, []).outstanding
    fields = state.fields
    payload = await capturedPayload(state)
  })

  it('transmits no value of any field lacking orchestratorVisible', () => {
    const hidden = ALL_FIELDS.filter((d) => d.orchestratorVisible !== true)
    expect(hidden.length).toBeGreaterThan(20)

    // Pins the fixture, not just the catalog filter above: these hidden,
    // sensitive fields must actually be outstanding (present in the redacted
    // view) and carry a real value in state (something for the gate to
    // redact), or the absence check below inspects nothing and passes for
    // free. id_number, passport_number and oh_foreign_buyer_form are
    // excluded by this profile's idForm/state, not by the redaction gate —
    // they are not asserted here.
    const outstandingIds = new Set(outstanding.map((f) => f.id))
    for (const id of ['tax_id', 'dob', 'dl_number', 'proof_of_residency']) {
      expect(outstandingIds.has(id), `${id} missing from outstanding`).toBe(true)
      expect(fields[id]?.value, `fixture never set a value for ${id}`).toBe(valueFor(id))
    }

    const hiddenIds = new Set(hidden.map((d) => d.id))
    const hiddenOutstanding = outstanding.filter((f) => hiddenIds.has(parseReqKey(f.id).fieldId))
    expect(hiddenOutstanding.length).toBeGreaterThan(20)

    for (const def of hidden) {
      expect(payload, `leaked ${def.id}`).not.toContain(valueFor(def.id))
    }
  })

  it('transmits the value of an orchestratorVisible field, proving it can see values at all', () => {
    const visible = ALL_FIELDS.filter((d) => d.orchestratorVisible === true)
    // If this is ever zero, the test above is vacuous and must be rewritten.
    expect(visible.length).toBeGreaterThan(0)
    for (const def of visible) {
      expect(payload, `never sent ${def.id}`).toContain(valueFor(def.id))
    }
  })

  it('carries the field identifiers, so the payload is not simply empty', () => {
    for (const def of ALL_FIELDS.slice(0, 5)) {
      expect(payload).toContain(def.id)
    }
  })
})
