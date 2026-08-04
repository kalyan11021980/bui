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

  it('suppresses voice when an accepted rationale touches a sensitive field', async () => {
    const { turn } = await run('Here is why we ask.', [
      { toolName: 'explain', input: { fieldId: 'tax_id' } },
    ], freshBusiness())
    expect(turn.blocks).toContainEqual({ kind: 'rationale', fieldId: 'tax_id' })
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('sensitive')
  })

  it('suppresses voice when the accepted document_request backs a sensitive field', async () => {
    // drivers_license is PROFILE's idForm, so it is in documentsToUpload
    // already, and it backs dl_number/dob — both sensitive.
    const { turn } = await run('Photograph it for me.', [
      { toolName: 'requestDocument', input: { docType: 'drivers_license' } },
    ])
    expect(turn.blocks).toContainEqual({ kind: 'document_request', docType: 'drivers_license' })
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('sensitive')
  })

  it('keeps voice for a document_request that backs no sensitive field', async () => {
    // dealer_license backs only business/license fields, none of which are
    // marked sensitive — the contrast case that proves suppression is keyed
    // on the document, not merely "any document_request".
    const licensedProfile = { ...PROFILE, licenses: ['dealer' as const] }
    const state = createApplication('app-1', licensedProfile, 'tok')
    const { turn } = await run('Right — a couple more.', [
      { toolName: 'requestDocument', input: { docType: 'dealer_license' } },
    ], state)
    expect(turn.blocks).toContainEqual({ kind: 'document_request', docType: 'dealer_license' })
    expect(turn.voice).toBe('Right — a couple more.')
    expect(turn.voiceDropped).toBeUndefined()
  })

  it('still falls back when only an action survives, so the screen is never empty', async () => {
    const { turn, actions } = await run('Got it, one sec.', [
      { toolName: 'setProfile', input: { patch: { wantsGsa: true } } },
    ])
    expect(actions).toHaveLength(1)
    expect(turn.blocks).toContainEqual({ kind: 'notice', copyId: 'guard_fallback' })
    expect(turn.blocks.some((b) => b.kind === 'field_ask')).toBe(true)
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

  it('numbers the turn from the highest existing seq, not the transcript length', async () => {
    // Seqs start above the array length — a windowed transcript (fewer
    // entries than the record) must not renumber onto a seq that already exists.
    const prior: Turn[] = [
      { seq: 5, at: AT, role: 'agent', voice: null, blocks: [] },
      { seq: 6, at: AT, role: 'applicant', voice: null, blocks: [], text: 'hi' },
    ]
    const { turn } = await run('Sure.', ASK_NAME, fresh(), prior)
    expect(turn.seq).toBe(7)
  })
})
