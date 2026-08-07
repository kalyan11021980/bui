import { describe, it, expect, beforeEach } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { POST as turn } from '@/app/api/application/[id]/turn/route'
import { __setModelForTurnTests, modelForTurn } from '@/server/orchestrator/model-for-turn'
import { applyAction, applyTurn } from '@/server/application-service'
import { ingestDocument } from '@/server/document-service'
import { __resetStoreForTests, getApplication, putApplication } from '@/server/store'
import { __resetAuditLogForTests, getAuditLog } from '@/server/audit'
import { createApplication } from '@/domain/application/reducer'
import { OWNER_TOKEN_HEADER } from '@/server/ownership'
import { stubModel } from '../server/orchestrator/stub-model'
import { pngBase64 } from '../server/image-bytes'

const AT = '2026-08-03T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
  bizCountry: null,
}

function seed(id = 'app-1', token = 'tok') {
  const state = createApplication(id, PROFILE, token)
  putApplication(state)
  return state
}

function post(id: string, body: unknown, token: string | null = 'tok') {
  return turn(
    new Request(`http://test/api/application/${id}/turn`, {
      method: 'POST',
      headers: token ? { [OWNER_TOKEN_HEADER]: token } : {},
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

/** The seam the route exposes: swap the model (and its config) for one call. */
function useModel(model: ReturnType<typeof stubModel>): void {
  __setModelForTurnTests(() => ({ model, effort: 'low', isAnthropic: false }))
}

/**
 * A turn with no applicant text and no doneWith. No route shape produces
 * this today — every POST /turn body carries text or doneWith — but
 * applyTurn still accepts it, so these go straight to the service to pin
 * that defensive handling in case a second caller ever needs it.
 */
function silentTurn(id: string, token: string | null = 'tok') {
  return applyTurn(id, token, {
    text: undefined,
    doneWith: undefined,
    modelForTurn,
    isResume: false,
    uploadedDocs: [],
    at: AT,
  })
}

/** Explains an outstanding field on a fresh individual application — never rejected. */
function defaultModel(onGenerate?: () => void): ReturnType<typeof stubModel> {
  return stubModel('Right, one to start.', [
    { toolName: 'explain', input: { fieldId: 'primary_activity' } },
  ], onGenerate)
}

/** proof_of_residency is never owed by PROFILE (addressDiffersFromId is false) — guaranteed guard-reject. */
function rejectedModel(): ReturnType<typeof stubModel> {
  return stubModel('One moment.', [
    { toolName: 'requestDocument', input: { docType: 'proof_of_residency' } },
  ])
}

function throwingModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error('model unreachable') },
  })
}

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
  useModel(defaultModel())
})

describe('POST /turn', () => {
  it('answers 404 for an unknown id', async () => {
    expect((await post('nope', { text: 'hi' })).status).toBe(404)
  })

  it('answers 404 for a wrong token, the same as for an unknown id', async () => {
    seed()
    expect((await post('app-1', { text: 'hi' }, 'wrong')).status).toBe(404)
  })

  it('answers 409 once submitted', async () => {
    putApplication({ ...seed(), submittedAt: '2026-08-03T00:00:00.000Z' })
    expect((await post('app-1', { text: 'hi' })).status).toBe(409)
  })

  it('appends exactly one agent turn to the transcript', async () => {
    seed()
    await post('app-1', { text: 'go on' })
    // One applicant turn (this call's text) plus one agent turn — not two
    // agent turns from a duplicate append.
    expect(getApplication('app-1')?.transcript).toHaveLength(2)
  })

  it('appends the applicant turn before the agent turn', async () => {
    seed()
    await post('app-1', { text: 'I am a dealer' })
    const roles = getApplication('app-1')?.transcript.map((t) => t.role)
    expect(roles).toEqual(['applicant', 'agent'])
  })

  it('writes one agent_turn audit event carrying a shownCopyHash', async () => {
    seed()
    await post('app-1', { text: 'go on' })
    const events = getAuditLog().entriesFor('app-1')
      .filter((e) => e.kind === 'agent_turn')
    expect(events).toHaveLength(1)
    expect(events[0]?.shownCopyHash).toBeTruthy()
  })

  it('counts a guard rejection on the record, and audits its reason code', async () => {
    seed()
    useModel(rejectedModel())
    await post('app-1', { text: 'go on' })
    expect(getApplication('app-1')?.orchestratorRejections).toBeGreaterThan(0)
    const event = getAuditLog().entriesFor('app-1').find((e) => e.kind === 'agent_turn')
    expect(event?.rejections).toEqual(['document_not_required'])
  })

  it('drops to panel-only on the third rejection, replacing the ask rather than joining it', async () => {
    seed()
    useModel(rejectedModel())
    for (let i = 0; i < 3; i += 1) await post('app-1', { text: 'go on' })
    expect(getApplication('app-1')?.orchestratorRejections).toBe(3)
    const last = getApplication('app-1')?.transcript.at(-1)
    // Exact, not toContainEqual: "I'll step back" must not share the turn
    // with the agent's own ask, or the notice contradicts itself.
    expect(last?.blocks).toEqual([{ kind: 'notice', copyId: 'panel_only_notice' }])
  })

  it('does not drop to panel-only before the third rejection', async () => {
    // The negative case: without it, a threshold that fires on every
    // rejection (or never) would look identical to "the third" from the
    // positive test alone.
    seed()
    useModel(rejectedModel())
    await post('app-1', { text: 'go on' })
    const last = getApplication('app-1')?.transcript.at(-1)
    expect(last?.blocks).not.toContainEqual({ kind: 'notice', copyId: 'panel_only_notice' })
  })

  it('returns a degraded notice when the model throws, leaving fields untouched', async () => {
    seed()
    applyAction('app-1', 'tok', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT,
    })
    const before = getApplication('app-1')

    useModel(throwingModel())
    const response = await post('app-1', { text: 'go on' })
    expect(response.status).toBe(200)

    const after = getApplication('app-1')
    expect(after?.fields).toEqual(before?.fields)
    expect(after?.transcript.at(-1)?.blocks)
      .toContainEqual({ kind: 'notice', copyId: 'degraded_notice' })
  })

  it('does not count a degraded, model-down turn as a guard rejection', async () => {
    // A thrown model call never reaches the guard, so it must not silently
    // masquerade as a rejection — that would drop an applicant to panel-only
    // for a server-side outage rather than their own answers.
    seed()
    useModel(throwingModel())
    await post('app-1', { text: 'go on' })
    expect(getApplication('app-1')?.orchestratorRejections).toBe(0)
  })

  it('a throw building the model view answers 422, not an unhandled 500', async () => {
    // A stored field with no catalog entry makes toOrchestratorView throw —
    // a real, reachable fault (a catalog edit landing after data was
    // written), and applyTurn must map it the same way applyAction maps a
    // reducer refusal, not let it surface as a crash.
    const state = seed()
    putApplication({
      ...state,
      fields: { ...state.fields, not_a_field: { value: 'x', status: 'confirmed' } },
    })
    const response = await post('app-1', { text: 'go on' })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/unknown field/i) })
  })

  it('applies a SET_VALUE committed while the model call is in flight, not a pre-await snapshot', async () => {
    // The concrete race: the panel and the chat are both open (Task 14
    // wires exactly this up). A POST /actions lands mid-turn. Without a
    // re-read after the await, this turn's commits would reduce from the
    // state captured before the model call and silently erase it.
    seed()
    useModel(defaultModel(() => {
      applyAction('app-1', 'tok', {
        type: 'SET_VALUE', fieldId: 'first_name', value: 'Concurrent', source: 'user', at: AT,
      })
    }))
    await post('app-1', { text: 'go on' })
    expect(getApplication('app-1')?.fields.first_name?.value).toBe('Concurrent')
  })

  it('rejects a request for a document already uploaded, once genuinely ingested', async () => {
    // Uploads through the real service — the same commit path an applicant's
    // photo takes — rather than pre-filling `documents` on the state by
    // hand. Only the former proves ingestDocument -> reducer -> uploadedDocTypes
    // -> route -> guard is actually wired end to end.
    seed()
    const ingested = await ingestDocument({
      applicationId: 'app-1',
      ownerToken: 'tok',
      docType: 'drivers_license',
      imageBase64: pngBase64(1600, 1000),
      at: AT,
      provider: async () => ({ text: '', detections: [] }),
    })
    expect(ingested.ok).toBe(true)

    useModel(stubModel('One moment.', [
      { toolName: 'requestDocument', input: { docType: 'drivers_license' } },
    ]))
    await post('app-1', { text: 'go on' })

    expect(getApplication('app-1')?.orchestratorRejections).toBe(1)
    // Not the first agent_turn: ingestDocument's own presentPlan call already
    // appended one (the group it presents), ahead of this call's.
    const event = getAuditLog().entriesFor('app-1')
      .filter((e) => e.kind === 'agent_turn').at(-1)
    expect(event?.rejections).toEqual(['document_already_held'])
  })

  it('answers 409 if the application is submitted while the model call is in flight', async () => {
    const state = seed()
    useModel(defaultModel(() => {
      putApplication({ ...state, submittedAt: AT })
    }))
    const response = await post('app-1', { text: 'go on' })
    expect(response.status).toBe(409)
    // The concurrent SUBMIT's write replays a state captured before this
    // call's applicant turn landed, clobbering it — so even though this
    // call did send text, nothing from it survives the race.
    expect(getApplication('app-1')?.transcript).toEqual([])
  })

  it('rejects a body with neither text nor doneWith', async () => {
    seed()
    const response = await post('app-1', {})
    expect(response.status).toBe(400)
  })

  it('rejects a body with both text and doneWith', async () => {
    seed()
    const response = await post('app-1', { text: 'hi', doneWith: 'address' })
    expect(response.status).toBe(400)
  })

  it('rejects blank text', async () => {
    seed()
    const response = await post('app-1', { text: '   ' })
    expect(response.status).toBe(400)
  })

  it('rejects a doneWith outside the Section union', async () => {
    seed()
    const response = await post('app-1', { doneWith: 'bogus' })
    expect(response.status).toBe(400)
  })

  it('a Done commits an applicant turn in vetted copy and answers with the agent turn', async () => {
    seed()
    const response = await post('app-1', { doneWith: 'profile' })
    expect(response.status).toBe(200)
    const { state, turn } = await response.json()
    const applicant = state.transcript.at(-2)
    expect(applicant.role).toBe('applicant')
    expect(applicant.text).toBe("Done with this section — what's next?")
    expect(turn.role).toBe('agent')
  })
})

describe('applyTurn — text-less turns (service-level)', () => {
  it('shows the step-back notice once across consecutive silent turns, not on every one', async () => {
    seed()
    useModel(rejectedModel())
    for (let i = 0; i < 5; i += 1) await silentTurn('app-1')
    const transcript = getApplication('app-1')?.transcript ?? []
    const notices = transcript.filter((t) =>
      t.blocks.some((b) => b.kind === 'notice' && b.copyId === 'panel_only_notice'))
    expect(notices).toHaveLength(1)
    // The turns after it commit (they carry the audit trail) but show nothing.
    expect(transcript.at(-1)?.blocks).toEqual([])
  })

  it('repeats the step-back notice when the applicant speaks again — a person is never ignored', async () => {
    seed()
    useModel(rejectedModel())
    for (let i = 0; i < 4; i += 1) await silentTurn('app-1')
    await post('app-1', { text: 'Hello? Are you there?' })
    const transcript = getApplication('app-1')?.transcript ?? []
    const notices = transcript.filter((t) =>
      t.blocks.some((b) => b.kind === 'notice' && b.copyId === 'panel_only_notice'))
    expect(notices).toHaveLength(2)
  })
})
