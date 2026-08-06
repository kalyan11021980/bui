import { describe, it, expect, beforeEach } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { POST as CREATE } from '@/app/api/application/route'
import { GET } from '@/app/api/application/[id]/route'
import { POST as ACTIONS } from '@/app/api/application/[id]/actions/route'
import { POST as TURN } from '@/app/api/application/[id]/turn/route'
import { __setModelForTurnTests } from '@/server/orchestrator/model-for-turn'
import { OWNER_TOKEN_HEADER } from '@/server/ownership'
import { __resetStoreForTests } from '@/server/store'
import { __resetAuditLogForTests } from '@/server/audit'
import { stubModel } from '../server/orchestrator/stub-model'
import type { ApplicationState } from '@/domain/application/state'

/**
 * §11.1: the agent is not a single point of failure. Drives the real route
 * handlers — CREATE, ACTIONS, TURN, GET — never the service functions
 * directly, because the claim under test is that the deployed HTTP surface
 * survives a dead model, not that some inner function does.
 */

const SET_AT = '2026-08-04T09:00:00.000Z'
const SUBMIT_AT = '2026-08-04T10:00:00.000Z'

/** What a fresh individual application (drivers_license, no state rules) owes in full. */
const ANSWERS: ReadonlyArray<readonly [string, unknown]> = [
  ['primary_activity', 'dealer'], ['preferred_language', 'English'],
  ['first_name', 'Ada'], ['last_name', 'Lovelace'],
  ['dl_number', 'D1234567'], ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'],
  ['id_images', ['front.png']], ['id_country', 'USA'], ['id_state', 'GA'],
  ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
  ['addr_state', 'GA'], ['addr_zip', '30301'], ['phone_mobile', '4045551234'],
]

const tokens = new Map<string, string>()

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function asOwner(id: string): Record<string, string> {
  const token = tokens.get(id)
  return token === undefined ? {} : { [OWNER_TOKEN_HEADER]: token }
}

async function newApp(): Promise<string> {
  const res = await CREATE()
  const body = (await res.json()) as ApplicationState
  if (body.ownerToken === null) throw new Error('creation handed out no owner token')
  tokens.set(body.id, body.ownerToken)
  return body.id
}

async function postAction(id: string, action: unknown) {
  return ACTIONS(
    new Request(`http://localhost/api/application/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action }),
      headers: { 'content-type': 'application/json', ...asOwner(id) },
    }),
    ctx(id),
  )
}

async function postTurn(id: string, body: unknown) {
  return TURN(
    new Request(`http://localhost/api/application/${id}/turn`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...asOwner(id) },
    }),
    ctx(id),
  )
}

async function stateOf(id: string): Promise<ApplicationState> {
  const res = await GET(
    new Request(`http://localhost/api/application/${id}`, { headers: asOwner(id) }),
    ctx(id),
  )
  return (await res.json()) as ApplicationState
}

/** A model call that reaches the network but fails there. */
function throwingModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error('model unreachable') },
  })
}

function useModel(model: ReturnType<typeof throwingModel>): void {
  __setModelForTurnTests(() => ({ model, effort: 'low', isAnthropic: false }))
}

/** Fills every outstanding field through the panel path — POST /actions. */
async function fillPanel(id: string, answers: ReadonlyArray<readonly [string, unknown]>) {
  for (const [fieldId, value] of answers) {
    const res = await postAction(id, {
      type: 'SET_VALUE', fieldId, value, source: 'user', at: SET_AT,
    })
    expect(res.status, `${fieldId} should have been accepted`).toBe(200)
  }
}

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
  tokens.clear()
})

describe('degraded mode — §11.1 the agent is not a single point of failure', () => {
  it('completes a whole registration through the panel with the model throwing on every call', async () => {
    const degradedId = await newApp()
    useModel(throwingModel())

    // Throws at the start, the middle, and right before submission — "every
    // call" means every call, not just the first.
    expect((await postTurn(degradedId, { text: 'hi' })).status).toBe(200)
    await fillPanel(degradedId, ANSWERS.slice(0, 7))
    expect((await postTurn(degradedId, { text: 'are you there?' })).status).toBe(200)
    await fillPanel(degradedId, ANSWERS.slice(7))
    expect((await postTurn(degradedId, { text: 'go on' })).status).toBe(200)

    const submitRes = await postAction(degradedId, { type: 'SUBMIT', at: SUBMIT_AT })
    expect(submitRes.status).toBe(200)

    const degraded = await stateOf(degradedId)
    expect(degraded.submittedAt).toBe(SUBMIT_AT)

    const degradedNotices = degraded.transcript.filter(
      (t) => t.blocks.some((b) => b.kind === 'notice' && b.copyId === 'degraded_notice'),
    )
    expect(degradedNotices.length).toBe(3)

    // A model failure must never register as a guard rejection — that would
    // drop the applicant to panel-only for an outage that was never theirs.
    expect(degraded.orchestratorRejections).toBe(0)

    // The control: the identical registration, driven the identical way,
    // with a model that actually answers.
    const workingId = await newApp()
    __setModelForTurnTests(() => ({
      model: stubModel('Right, one to start.', [
        { toolName: 'explain', input: { fieldId: 'primary_activity' } },
      ]),
      effort: 'low', isAnthropic: false,
    }))

    const workingTurn = await postTurn(workingId, { text: 'hi' })
    expect(workingTurn.status).toBe(200)
    const afterWorkingTurn = await stateOf(workingId)
    expect(afterWorkingTurn.transcript.at(-1)?.blocks)
      .not.toContainEqual({ kind: 'notice', copyId: 'degraded_notice' })

    await fillPanel(workingId, ANSWERS)
    const workingSubmit = await postAction(workingId, { type: 'SUBMIT', at: SUBMIT_AT })
    expect(workingSubmit.status).toBe(200)

    const working = await stateOf(workingId)
    expect(working.submittedAt).toBe(SUBMIT_AT)

    // The claim: indistinguishable outcomes. Same fields, same statuses,
    // same submission — the model's health left no mark on the record.
    expect(degraded.fields).toEqual(working.fields)
    expect(degraded.submittedAt).toEqual(working.submittedAt)
  })

  it('degrades the same way when the model configuration cannot even be resolved', async () => {
    // runTurnSafely wraps two distinct failures in the same try/catch: the
    // model call itself (covered above) and resolving the model in the first
    // place — a misconfigured or missing ORCHESTRATOR_MODEL, thrown
    // synchronously before any network call happens. Every other test in
    // this suite overrides the seam with a function that always succeeds;
    // this one makes the seam itself the failure.
    const id = await newApp()
    __setModelForTurnTests(() => {
      throw new Error('ORCHESTRATOR_MODEL must be set')
    })

    const res = await postTurn(id, { text: 'hi' })
    expect(res.status).toBe(200)

    const state = await stateOf(id)
    expect(state.transcript.at(-1)?.blocks)
      .toContainEqual({ kind: 'notice', copyId: 'degraded_notice' })
    expect(state.orchestratorRejections).toBe(0)

    // The panel still works — the same proof as the full test above, at
    // smaller scale: one field through, still accepted.
    const fieldRes = await postAction(id, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: SET_AT,
    })
    expect(fieldRes.status).toBe(200)
    expect((await stateOf(id)).fields.first_name?.value).toBe('Ada')
  })

  it('a dead model still presents the titled group', async () => {
    const id = await newApp()
    useModel(throwingModel())

    // A fresh application owes 'profile' first; doneWith targets a later
    // section so the plan returns straight to the group, not a gapped notice
    // on top of the degraded one.
    const res = await postTurn(id, { doneWith: 'contact' })
    expect(res.status).toBe(200)
    const { turn } = await res.json()

    expect(turn.blocks[0]).toEqual({ kind: 'notice', copyId: 'degraded_notice' })
    expect(turn.blocks[1]).toMatchObject({ kind: 'section_header', section: 'profile' })
  })
})
