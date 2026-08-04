import { describe, it, expect } from 'vitest'
import { runTurn } from '@/server/orchestrator/service'
import { toOrchestratorView } from '@/domain/orchestrator/view'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { Turn } from '@/domain/orchestrator/transcript'
import { stubModel } from './stub-model'

const AT = '2026-08-03T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}
// tax_id is only required for a business applicant — needed to exercise the
// sensitive-field suppression, since askFor(tax_id) is guard-rejected for PROFILE.
const BUSINESS_PROFILE = { ...PROFILE, applicantType: 'business' as const }

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }
function freshBusiness(): ApplicationState {
  return createApplication('app-1', BUSINESS_PROFILE, 'tok')
}

async function run(
  text: string,
  calls: Parameters<typeof stubModel>[1],
  state = fresh(),
  transcript: readonly Turn[] = [],
) {
  return runTurn({
    model: stubModel(text, calls),
    view: toOrchestratorView(state, []),
    state, transcript, uploadedDocs: [], userText: null,
    isResume: false, at: AT, effort: 'low', isAnthropic: false,
  })
}

const ASK_NAME = [{ toolName: 'askFor', input: { fieldIds: ['first_name'] } }]

describe('runTurn', () => {
  it('keeps voice that passes the lint', async () => {
    const { turn } = await run('Right — a couple more.', ASK_NAME)
    expect(turn.voice).toBe('Right — a couple more.')
    expect(turn.voiceDropped).toBeUndefined()
  })

  it('drops voice that fails the lint and records why', async () => {
    const { turn } = await run('You have 3 things left.', ASK_NAME)
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('lint')
  })

  it('suppresses voice entirely when the ask includes a sensitive field', async () => {
    const { turn } = await run('All good, one more.', [
      { toolName: 'askFor', input: { fieldIds: ['tax_id'] } },
    ], freshBusiness())
    expect(turn.blocks).toContainEqual({ kind: 'field_ask', fieldId: 'tax_id' })
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('sensitive')
  })

  it('drops a rejected tool call and records its code', async () => {
    let state = fresh()
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'K', source: 'user', at: AT,
    })
    const { turn, rejections } = await run('Sure.', ASK_NAME, state)
    expect(rejections).toContain('field_not_outstanding')
    expect(turn.blocks).not.toContainEqual({ kind: 'field_ask', fieldId: 'first_name' })
  })

  it('falls back to a server-built ask when nothing survives', async () => {
    const { turn } = await run('Sure.', [
      { toolName: 'askFor', input: { fieldIds: ['not_a_field'] } },
    ])
    expect(turn.blocks).toContainEqual({ kind: 'notice', copyId: 'guard_fallback' })
    expect(turn.blocks.some((b) => b.kind === 'field_ask')).toBe(true)
  })

  it('applies surviving calls even when a sibling was rejected', async () => {
    const { turn, rejections } = await run('Sure.', [
      { toolName: 'askFor', input: { fieldIds: ['first_name'] } },
      { toolName: 'requestDocument', input: { docType: 'proof_of_residency' } },
    ])
    expect(turn.blocks).toContainEqual({ kind: 'field_ask', fieldId: 'first_name' })
    expect(rejections).toEqual(['document_not_required'])
    // The fallback is for when NOTHING survives — a surviving call must
    // suppress it, or "correctly withheld" and "never offered" look identical.
    expect(turn.blocks).not.toContainEqual({ kind: 'notice', copyId: 'guard_fallback' })
  })

  it('numbers the turn as the next in the transcript', async () => {
    const prior: Turn[] = [
      { seq: 1, at: AT, role: 'agent', voice: null, blocks: [] },
      { seq: 2, at: AT, role: 'applicant', voice: null, blocks: [], text: 'hi' },
    ]
    const { turn } = await run('Sure.', ASK_NAME, fresh(), prior)
    expect(turn.seq).toBe(3)
  })
})
