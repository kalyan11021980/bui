import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useConversation } from '@/ui/client/useConversation'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Turn } from '@/domain/orchestrator/transcript'

const AT = '2026-08-04T00:00:00.000Z'
const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}
const OWNER = 'owner-token-1'

type Call = { url: string; body: unknown }
let calls: Call[]

function stubFetch(respond: (call: Call) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call = { url, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const { status, body } = respond(call)
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    })
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('useConversation', () => {
  it('fires no request on mount', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)
    renderHook(() => useConversation('app-1', OWNER, state, () => undefined))
    expect(calls).toHaveLength(0)
  })

  it('ignores blank input — nothing to send is not a turn', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, () => undefined))
    act(() => result.current.send('   '))
    expect(calls).toHaveLength(0)
  })

  it('posts intent text and appends the turns the response carries', async () => {
    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = { seq: 2, at: AT, role: 'agent', voice: 'Hello!', blocks: [] }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }
    stubFetch(() => ({ status: 200, body: { state: after, turn: agentTurn } }))

    const onState = vi.fn()
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, onState))

    act(() => result.current.send('Hi'))
    expect(result.current.pending).toBe(true)

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.turns).toEqual([applicantTurn, agentTurn])
    expect(onState).toHaveBeenCalledWith(after)

    const turnCall = calls.find((c) => c.url.endsWith('/turn'))
    expect(turnCall?.body).toEqual({ text: 'Hi' })
  })

  it('never re-shows turns already in initialState.transcript — a resume does not replay history', async () => {
    const old1: Turn = { seq: 1, at: AT, role: 'agent', voice: 'old', blocks: [] }
    const old2: Turn = { seq: 2, at: AT, role: 'applicant', voice: null, blocks: [], text: 'old reply' }
    const seeded = createApplication('app-1', PROFILE, OWNER)
    const resumedState: ApplicationState = { ...seeded, transcript: [old1, old2] }

    const applicantTurn: Turn = { seq: 3, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = { seq: 4, at: AT, role: 'agent', voice: 'Welcome back!', blocks: [] }
    const after: ApplicationState = { ...resumedState, transcript: [old1, old2, applicantTurn, agentTurn] }
    stubFetch(() => ({ status: 200, body: { state: after, turn: agentTurn } }))

    const { result } = renderHook(() => useConversation('app-1', OWNER, resumedState, () => undefined))
    expect(result.current.turns).toEqual([])

    act(() => result.current.send('Hi'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(result.current.turns).toEqual([applicantTurn, agentTurn])
  })

  it('falls back to a local degraded notice when the request never reaches a server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const state = createApplication('app-1', PROFILE, OWNER)
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, () => undefined))

    act(() => result.current.send('Hi'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(result.current.turns).toHaveLength(1)
    expect(result.current.turns[0]).toMatchObject({
      role: 'agent', voice: null, blocks: [{ kind: 'notice', copyId: 'degraded_notice' }],
    })
  })
})
