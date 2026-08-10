import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { applyTurn } from '@/server/application-service'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { requiredFields } from '@/domain/requirements/engine'
import { outstandingFields } from '@/domain/application/queries'
import { useConversation } from '@/ui/client/useConversation'
import { __resetStoreForTests, putApplication } from '@/server/store'
import { __resetAuditLogForTests } from '@/server/audit'
import { stubModel } from '../server/orchestrator/stub-model'
import type { ApplicationState, Action } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { RequirementKey } from '@/domain/requirements/key'
import type { Turn } from '@/domain/orchestrator/transcript'

/** §12.1: a returning applicant lands on the panel with a one-line
 *  orientation, not a replayed transcript. */

const AT = '2026-08-04T09:00:00.000Z'
const OWNER = 'owner-token-1'
const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: null, wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

/** A prior session's history — settled, not something the panel replays. */
const PRIOR_TRANSCRIPT: readonly Turn[] = [
  {
    seq: 1, at: AT, role: 'agent', voice: 'Right, one to start.',
    blocks: [{ kind: 'field_ask', fieldId: 'first_name' }],
  },
  { seq: 2, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Ada' },
]

/**
 * Five fields the applicant typed (confirmed) and one read off a document but
 * not yet looked at (derived) — still outstanding. The derived field is the
 * point: `outstandingFields` counts it as owed, so a `done` that came from
 * summing raw field entries instead of the real requirement/outstanding
 * functions would land on 6, not 5.
 */
function resumedState(): ApplicationState {
  let state = createApplication('app-1', PROFILE, OWNER)
  state = { ...state, transcript: PRIOR_TRANSCRIPT }

  const confirmed: ReadonlyArray<readonly [RequirementKey, string]> = [
    ['first_name', 'Ada'], ['last_name', 'Lovelace'], ['primary_activity', 'dealer'],
    ['preferred_language', 'English'], ['dob', '1982-08-31'],
  ]
  for (const [fieldId, value] of confirmed) {
    const action: Action = { type: 'SET_VALUE', fieldId, value, source: 'user', at: AT }
    state = applicationReducer(state, action)
  }

  const derived: Action = {
    type: 'SET_VALUE', fieldId: 'dl_number', value: 'D1234567', source: 'ocr', at: AT,
  }
  return applicationReducer(state, derived)
}

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
})

describe('resume — §12.1', () => {
  it('orients a returning applicant with the real done/total, not a double count', async () => {
    const state = resumedState()
    putApplication(state)

    // Pin the fixture, not just re-derive it: if these ever drift the test
    // below stops proving anything about the arithmetic.
    expect(requiredFields(state.profile).length).toBe(22)
    expect(outstandingFields(state).length).toBe(17)

    const result = await applyTurn('app-1', OWNER, {
      text: undefined,
      doneWith: undefined,
      modelForTurn: () => ({
        model: stubModel('', [{ toolName: 'orient', input: {} }]),
        effort: 'low',
      }),
      isResume: true,
      uploadedDocs: [],
      at: AT,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 5 confirmed of 22 required — the derived field (dl_number) still
    // counts as outstanding, so it must not also inflate `total`.
    expect(result.value.turn.blocks).toContainEqual({ kind: 'orientation', done: 5, total: 22 })
  })

  it('lands the client on the panel — a resumed session does not replay the transcript', () => {
    const state = resumedState()
    expect(state.transcript).toHaveLength(2)

    const { result } = renderHook(() => useConversation(
      state.id, OWNER, state, () => undefined, (run) => { void run() },
    ))

    // The prior session's two turns are on the record (asserted above), but
    // the hook seeds nothing from them: the applicant sees the panel showing
    // what is outstanding, not a replay of "Right, one to start." / "Ada".
    expect(result.current.turns).toEqual([])
  })
})
