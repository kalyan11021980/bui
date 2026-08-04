import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { Turn } from '@/domain/orchestrator/transcript'

const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}

function turn(seq: number): Turn {
  return {
    seq, at: '2026-08-03T00:00:00.000Z', role: 'agent',
    voice: 'Right — a couple more.',
    blocks: [{ kind: 'field_ask', fieldId: 'first_name' }],
  }
}

function fresh(): ApplicationState {
  return createApplication('app-1', PROFILE, 'tok')
}

describe('transcript on the application record', () => {
  it('starts empty with no rejections', () => {
    const state = fresh()
    expect(state.transcript).toEqual([])
    expect(state.orchestratorRejections).toBe(0)
  })

  it('appends turns in order', () => {
    let state = fresh()
    state = applicationReducer(state, { type: 'APPEND_TURN', turn: turn(1), at: turn(1).at })
    state = applicationReducer(state, { type: 'APPEND_TURN', turn: turn(2), at: turn(2).at })
    expect(state.transcript.map((t) => t.seq)).toEqual([1, 2])
  })

  it('refuses a turn whose seq is not the next one', () => {
    const state = applicationReducer(fresh(), {
      type: 'APPEND_TURN', turn: turn(1), at: turn(1).at,
    })
    expect(() => applicationReducer(state, {
      type: 'APPEND_TURN', turn: turn(3), at: turn(3).at,
    })).toThrow(/seq/)
  })

  it('counts rejections on the record so a reload cannot reset them', () => {
    let state = fresh()
    state = applicationReducer(state, { type: 'RECORD_REJECTION', at: turn(1).at })
    state = applicationReducer(state, { type: 'RECORD_REJECTION', at: turn(1).at })
    expect(state.orchestratorRejections).toBe(2)
  })

  it('refuses APPEND_TURN once submitted, like every other action', () => {
    const submitted = { ...fresh(), submittedAt: '2026-08-03T01:00:00.000Z' }
    expect(() => applicationReducer(submitted, {
      type: 'APPEND_TURN', turn: turn(1), at: turn(1).at,
    })).toThrow()
  })
})
