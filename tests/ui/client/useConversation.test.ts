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

/** Runs immediately — fine for every test that isn't about ordering itself. */
const runNow = (run: () => Promise<void>) => { void run() }

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('useConversation', () => {
  it('fires no request on mount', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)
    renderHook(() => useConversation('app-1', OWNER, state, () => undefined, runNow))
    expect(calls).toHaveLength(0)
  })

  it('ignores blank input — nothing to send is not a turn', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, () => undefined, runNow))
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
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, onState, runNow))

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

    const { result } = renderHook(() => useConversation('app-1', OWNER, resumedState, () => undefined, runNow))
    expect(result.current.turns).toEqual([])

    act(() => result.current.send('Hi'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    expect(result.current.turns).toEqual([applicantTurn, agentTurn])
  })

  it('falls back to a local degraded notice only when the request never reaches a server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const state = createApplication('app-1', PROFILE, OWNER)
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, () => undefined, runNow))

    act(() => result.current.send('Hi'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    // What was typed stays on screen — it was never delivered, so losing it
    // as well as the reply would be the worst of both.
    expect(result.current.turns.map((t) => t.role)).toEqual(['applicant', 'agent'])
    expect(result.current.turns[0]).toMatchObject({ role: 'applicant', text: 'Hi' })
    expect(result.current.turns[1]).toMatchObject({
      role: 'agent', voice: null, blocks: [{ kind: 'notice', copyId: 'degraded_notice' }],
    })
  })

  it('adds nothing to the transcript for a real refusal — no vetted copy fits "closed" or "unknown owner"', async () => {
    // status !== null means a server actually answered; degraded_notice's
    // wording ("I can't reach my assistant") would be false here.
    stubFetch(() => ({ status: 409, body: { error: 'This application has already been submitted' } }))
    const state = createApplication('app-1', PROFILE, OWNER)
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, () => undefined, runNow))

    act(() => result.current.send('Hi'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    // The applicant's own line stays; no agent turn is invented for it,
    // because no vetted copy describes "closed" or "unknown owner".
    expect(result.current.turns.filter((t) => t.role === 'agent')).toEqual([])
    expect(result.current.turns.map((t) => t.text)).toEqual(['Hi'])
  })

  it("gives a locally-made turn its own seq space, so a retry after a failure can never collide", async () => {
    // First send: transport failure -> a local degraded turn (seq <= -1).
    // Second send: succeeds, and the server's own transcript restarts its
    // seq count at 1 (it never received the first request at all). Before
    // the fix, both turns could land with the SAME seq, which TurnView keys
    // on — a real React key collision, not just a cosmetic one.
    let first = true
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (first) { first = false; throw new TypeError('Failed to fetch') }
      const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi again' }
      const agentTurn: Turn = { seq: 2, at: AT, role: 'agent', voice: 'Hello!', blocks: [] }
      const after: ApplicationState = {
        ...createApplication('app-1', PROFILE, OWNER), transcript: [applicantTurn, agentTurn],
      }
      return new Response(JSON.stringify({ state: after, turn: agentTurn }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))

    const state = createApplication('app-1', PROFILE, OWNER)
    const { result } = renderHook(() => useConversation('app-1', OWNER, state, () => undefined, runNow))

    act(() => result.current.send('Hi'))
    await waitFor(() => expect(result.current.pending).toBe(false))
    // The echo of what was typed, then the degraded notice — both local.
    expect(result.current.turns).toHaveLength(2)

    act(() => result.current.send('Hi again'))
    await waitFor(() => expect(result.current.pending).toBe(false))

    const seqs = result.current.turns.map((t) => t.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    // The failed turn's seq must not collide with a real, positive one.
    expect(seqs[0]).toBeLessThanOrEqual(-1)
  })

  it("routes the turn request through the caller's serialized queue, behind any write already enqueued", async () => {
    const order: string[] = []
    let releasePanelWrite: () => void = () => undefined
    const panelWrite = new Promise<void>((resolve) => { releasePanelWrite = resolve })

    const queue = { current: Promise.resolve() }
    const runSerialized = (run: () => Promise<void>) => {
      queue.current = queue.current.then(run, run).catch(() => undefined)
    }

    stubFetch((call) => { order.push(call.url); return { status: 200, body: {} } })

    // Enqueue a slow panel write ahead of the turn — mirrors `readDocument`
    // being enqueued while the applicant is still typing.
    runSerialized(async () => { await panelWrite; order.push('panel-write-done') })

    const state = createApplication('app-1', PROFILE, OWNER)
    const { result } = renderHook(
      () => useConversation('app-1', OWNER, state, () => undefined, runSerialized),
    )
    act(() => result.current.send('Hi'))

    // The turn's own fetch must not have gone out yet — it is queued
    // behind the panel write, not racing it.
    expect(calls).toHaveLength(0)

    releasePanelWrite()
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))

    expect(order.indexOf('panel-write-done')).toBeLessThan(
      order.findIndex((url) => url.endsWith('/turn')),
    )
  })

  describe('sendDone', () => {
    it('sendDone posts the section as structured intent, never text', async () => {
      const agentTurn: Turn = { seq: 1, at: AT, role: 'agent', voice: 'Next then.', blocks: [] }
      const state = createApplication('app-1', PROFILE, OWNER)
      const after: ApplicationState = { ...state, transcript: [agentTurn] }
      stubFetch(() => ({ status: 200, body: { state: after, turn: agentTurn } }))

      const { result } = renderHook(
        () => useConversation('app-1', OWNER, state, () => undefined, runNow),
      )
      act(() => result.current.sendDone('address'))
      await waitFor(() => expect(result.current.pending).toBe(false))

      const turnCall = calls.find((c) => c.url.endsWith('/turn'))
      expect(turnCall?.body).toEqual({ doneWith: 'address' })
    })

    it('sendDone echoes the vetted done line immediately', () => {
      const state = createApplication('app-1', PROFILE, OWNER)
      // Never resolves — this test asserts before any response lands, so
      // there is nothing for the mock to answer with.
      vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined))
      const { result } = renderHook(
        () => useConversation('app-1', OWNER, state, () => undefined, runNow),
      )
      act(() => result.current.sendDone('address'))

      expect(result.current.turns.at(-1)).toMatchObject({
        role: 'applicant',
        text: "Done with this section — what's next?",
      })
    })

    it('the echo is replaced by the committed turn when the reply lands', async () => {
      const doneTurn: Turn = {
        seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: "Done with this section — what's next?",
      }
      const agentTurn: Turn = { seq: 2, at: AT, role: 'agent', voice: 'Next then.', blocks: [] }
      const state = createApplication('app-1', PROFILE, OWNER)
      const after: ApplicationState = { ...state, transcript: [doneTurn, agentTurn] }
      stubFetch(() => ({ status: 200, body: { state: after, turn: agentTurn } }))

      const { result } = renderHook(
        () => useConversation('app-1', OWNER, state, () => undefined, runNow),
      )
      act(() => result.current.sendDone('address'))
      await waitFor(() => expect(result.current.pending).toBe(false))

      expect(result.current.turns.filter((t) => t.role === 'applicant')).toHaveLength(1)
      expect(result.current.turns.at(-2)!.seq).toBeGreaterThan(0)
    })
  })
})
