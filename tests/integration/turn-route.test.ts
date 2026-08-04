import { describe, it, expect, beforeEach } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { POST as turn } from '@/app/api/application/[id]/turn/route'
import { __setModelForTurnTests } from '@/server/orchestrator/model-for-turn'
import { __resetStoreForTests, getApplication, putApplication } from '@/server/store'
import { __resetAuditLogForTests, getAuditLog } from '@/server/audit'
import { createApplication } from '@/domain/application/reducer'
import { OWNER_TOKEN_HEADER } from '@/server/ownership'
import { stubModel } from '../server/orchestrator/stub-model'

const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
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

/** Asks for an outstanding field on a fresh individual application — never rejected. */
function defaultModel(): ReturnType<typeof stubModel> {
  return stubModel('Right, one to start.', [
    { toolName: 'askFor', input: { fieldIds: ['primary_activity'] } },
  ])
}

/** tax_id is a real field, but never outstanding for an individual — guaranteed guard-reject. */
function rejectedModel(): ReturnType<typeof stubModel> {
  return stubModel('One moment.', [
    { toolName: 'askFor', input: { fieldIds: ['tax_id'] } },
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
    expect((await post('nope', {})).status).toBe(404)
  })

  it('answers 404 for a wrong token, the same as for an unknown id', async () => {
    seed()
    expect((await post('app-1', {}, 'wrong')).status).toBe(404)
  })

  it('answers 409 once submitted', async () => {
    putApplication({ ...seed(), submittedAt: '2026-08-03T00:00:00.000Z' })
    expect((await post('app-1', {})).status).toBe(409)
  })

  it('appends exactly one agent turn to the transcript', async () => {
    seed()
    await post('app-1', {})
    expect(getApplication('app-1')?.transcript).toHaveLength(1)
  })

  it('appends the applicant turn before the agent turn', async () => {
    seed()
    await post('app-1', { text: 'I am a dealer' })
    const roles = getApplication('app-1')?.transcript.map((t) => t.role)
    expect(roles).toEqual(['applicant', 'agent'])
  })

  it('writes one agent_turn audit event carrying a shownCopyHash', async () => {
    seed()
    await post('app-1', {})
    const events = getAuditLog().entriesFor('app-1')
      .filter((e) => e.kind === 'agent_turn')
    expect(events).toHaveLength(1)
    expect(events[0]?.shownCopyHash).toBeTruthy()
  })

  it('counts a guard rejection on the record', async () => {
    seed()
    useModel(rejectedModel())
    await post('app-1', {})
    expect(getApplication('app-1')?.orchestratorRejections).toBeGreaterThan(0)
  })

  it('drops to panel-only on the third rejection', async () => {
    seed()
    useModel(rejectedModel())
    for (let i = 0; i < 3; i += 1) await post('app-1', {})
    expect(getApplication('app-1')?.orchestratorRejections).toBe(3)
    const last = getApplication('app-1')?.transcript.at(-1)
    expect(last?.blocks).toContainEqual({ kind: 'notice', copyId: 'panel_only_notice' })
  })

  it('does not drop to panel-only before the third rejection', async () => {
    // The negative case: without it, a threshold that fires on every
    // rejection (or never) would look identical to "the third" from the
    // positive test alone.
    seed()
    useModel(rejectedModel())
    await post('app-1', {})
    const last = getApplication('app-1')?.transcript.at(-1)
    expect(last?.blocks).not.toContainEqual({ kind: 'notice', copyId: 'panel_only_notice' })
  })

  it('returns a degraded notice when the model throws, leaving fields untouched', async () => {
    const before = seed()
    useModel(throwingModel())
    const response = await post('app-1', {})
    expect(response.status).toBe(200)
    const after = getApplication('app-1')
    expect(after?.fields).toEqual(before.fields)
    expect(after?.transcript.at(-1)?.blocks)
      .toContainEqual({ kind: 'notice', copyId: 'degraded_notice' })
  })

  it('does not count a degraded, model-down turn as a guard rejection', async () => {
    // A thrown model call never reaches the guard, so it must not silently
    // masquerade as a rejection — that would drop an applicant to panel-only
    // for a server-side outage rather than their own answers.
    seed()
    useModel(throwingModel())
    await post('app-1', {})
    expect(getApplication('app-1')?.orchestratorRejections).toBe(0)
  })
})
