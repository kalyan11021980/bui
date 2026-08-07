import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationShell } from '@/ui/chat/ConversationShell'
import type { BlockHandlers } from '@/ui/chat/blocks'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Turn } from '@/domain/orchestrator/transcript'
import { sendAction } from '@/ui/client/application-api'

/**
 * The shell against a stubbed server. The most important test here is
 * "keystrokes ... never the turn endpoint": a keystroke inside a field_ask
 * control must reach the panel's own write path (`/actions`) and never the
 * turn endpoint (`/turn`) — the §4 guarantee, at the UI layer.
 */

const AT = '2026-08-04T00:00:00.000Z'
const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
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

/** Runs immediately — every test here is unrelated to queue ordering itself. */
const runNow = (run: () => Promise<void>) => { void run() }

const noHandlers: BlockHandlers & {
  onSubmit: () => void
  onState: (state: ApplicationState) => void
  runSerialized: (run: () => Promise<void>) => void
  readingDocTypes: readonly DocType[]
} = {
  onChange: () => undefined,
  onClear: () => undefined,
  onConfirm: () => undefined,
  onReadDocument: () => undefined,
  onSubmit: () => undefined,
  onState: () => undefined,
  runSerialized: runNow,
  readingDocTypes: [],
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('ConversationShell', () => {
  it('renders the start greeting before any turn exists, with no fetch at all', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.getByRole('heading', { name: /set up to bid at IAA/i })).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('cannot render the greeting via a model call — the copy is local, not fetched', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    const state = createApplication('app-1', PROFILE, OWNER)

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.getByRole('heading', { name: /set up to bid at IAA/i })).toBeInTheDocument()
  })

  it('sends what the applicant types to the turn endpoint, as intent text', async () => {
    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = {
      seq: 2, at: AT, role: 'agent', voice: 'Sure — first things first.',
      blocks: [{ kind: 'field_ask', fieldId: 'first_name' }],
    }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }

    stubFetch((call) =>
      call.url.endsWith('/turn')
        ? { status: 200, body: { state: after, turn: agentTurn } }
        : { status: 200, body: after },
    )

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/turn'))).toBe(true))
    const turnCall = calls.find((c) => c.url.endsWith('/turn'))
    expect(turnCall?.body).toEqual({ text: 'Hi' })
    expect(screen.getByText('Sure — first things first.')).toBeInTheDocument()
  })

  it('scrolls a newly arrived turn into view — its start, without touching focus', async () => {
    // jsdom implements no scrolling; the stub is the assertion surface.
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = {
      seq: 2, at: AT, role: 'agent', voice: 'Sure — first things first.', blocks: [],
    }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }

    stubFetch((call) =>
      call.url.endsWith('/turn')
        ? { status: 200, body: { state: after, turn: agentTurn } }
        : { status: 200, body: after },
    )

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    const input = screen.getByLabelText(/tell the agent something/i)
    await userEvent.type(input, 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(scrollIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ block: 'start' }),
    )
    // §9.1 — the arrival must not steal focus from wherever the applicant is.
    expect(document.activeElement).not.toBe(document.body)

    // Hand the prototype back to the setup.ts stub for the rest of the file.
    Element.prototype.scrollIntoView = () => undefined
  })

  it('keystrokes in a field_ask control reach the panel handler, never the turn endpoint', async () => {
    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = {
      seq: 2, at: AT, role: 'agent', voice: null,
      blocks: [{ kind: 'field_ask', fieldId: 'first_name' }],
    }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }

    stubFetch((call) =>
      call.url.endsWith('/turn')
        ? { status: 200, body: { state: after, turn: agentTurn } }
        : { status: 200, body: after },
    )

    // The same function the panel itself uses for a keystroke — proof this
    // is the real path, not a stand-in that only records having been called.
    const onChange: BlockHandlers['onChange'] = (id, value) => {
      void sendAction('app-1', OWNER, { type: 'SET_VALUE', fieldId: id, value, source: 'user', at: AT })
    }

    render(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} onChange={onChange}
      />,
    )

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    const input = await screen.findByLabelText(/first name/i, { selector: 'input, select, textarea' })
    // Isolate what typing into the field does from the composer's own call.
    calls.length = 0

    await userEvent.type(input, 'Ada')

    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/actions'))).toBe(true))
    expect(calls.some((c) => c.url.endsWith('/turn'))).toBe(false)
  })

  it('stops a stale field_ask box from reaching the reducer once the application closes', async () => {
    // History is not pruned — see useConversation's own comment — so a
    // field_ask box asked before submission is still on screen after it. The
    // reducer refuses every write once closed by throwing; this box must not
    // still be wired to it, or reopening it crashes instead of doing nothing.
    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = {
      seq: 2, at: AT, role: 'agent', voice: null,
      blocks: [{ kind: 'field_ask', fieldId: 'first_name' }],
    }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }

    stubFetch((call) =>
      call.url.endsWith('/turn')
        ? { status: 200, body: { state: after, turn: agentTurn } }
        : { status: 200, body: after },
    )

    const onChange = vi.fn()

    const { rerender } = render(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} onChange={onChange}
      />,
    )

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    const input = await screen.findByLabelText(/first name/i, { selector: 'input, select, textarea' })

    // The panel's own submit closed the application — nothing this shell did.
    const closed: ApplicationState = { ...after, submittedAt: AT }
    rerender(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={closed}
        {...noHandlers} onChange={onChange}
      />,
    )

    await userEvent.type(input, 'Ada')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps focus on Send through a pending turn — never stolen by the update (§9.1)', async () => {
    let resolveTurn: (response: Response) => void = () => undefined
    const deferred = new Promise<Response>((resolve) => { resolveTurn = resolve })
    const state = createApplication('app-1', PROFILE, OWNER)

    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/turn')) return deferred
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    const sendButton = screen.getByRole('button', { name: /send/i })
    await userEvent.click(sendButton)

    // Mid-flight: the button is aria-disabled, but never DOM-disabled, so
    // focus stays exactly where the applicant put it.
    expect(sendButton).toHaveFocus()
    expect(sendButton).not.toBeDisabled()

    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = { seq: 2, at: AT, role: 'agent', voice: 'Hello!', blocks: [] }
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }
    resolveTurn(new Response(JSON.stringify({ state: after, turn: agentTurn }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))

    await screen.findByText('Hello!')
    expect(sendButton).toHaveFocus()
  })

  it('mounts the Done bar under the log once a group is on screen', async () => {
    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = {
      seq: 2, at: AT, role: 'agent', voice: null,
      blocks: [{ kind: 'section_header', section: 'identification', done: 0, total: 3 }],
    }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }

    stubFetch((call) =>
      call.url.endsWith('/turn')
        ? { status: 200, body: { state: after, turn: agentTurn } }
        : { status: 200, body: after },
    )

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByRole('button', { name: 'Done with this section' })).toBeInTheDocument()
  })

  it('never fires a turn unprompted', () => {
    // The old nudge trigger was `panelWrites` going up — which happened on
    // every panel write, i.e. every time `state` itself changed. `state` is
    // the only surviving prop that still changes on a panel write, so a
    // rerender with a freshly answered field is that trigger's stand-in.
    const state = createApplication('app-1', PROFILE, OWNER)
    stubFetch(() => ({ status: 200, body: state }))

    const { rerender } = render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    calls.length = 0

    vi.useFakeTimers()
    try {
      const written: ApplicationState = {
        ...state,
        fields: { ...state.fields, first_name: { value: 'Ada', status: 'confirmed' } },
      }
      rerender(
        <ConversationShell applicationId="app-1" ownerToken={OWNER} state={written} {...noHandlers} />,
      )

      act(() => { vi.advanceTimersByTime(5000) })

      expect(calls.some((c) => c.url.endsWith('/turn'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts centered and docks on the first send', async () => {
    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = { seq: 2, at: AT, role: 'agent', voice: 'Hello!', blocks: [] }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }

    stubFetch((call) =>
      call.url.endsWith('/turn')
        ? { status: 200, body: { state: after, turn: agentTurn } }
        : { status: 200, body: after },
    )

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    expect(screen.getByRole('heading', { name: /set up to bid/i })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    // The optimistic echo alone docks the layout — before the agent answers.
    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
    expect(screen.getByRole('log')).toBeInTheDocument()
    await screen.findByText('Hello!')
  })

  it('docks when the first photo starts reading, status shown on the card alone', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)

    const { rerender } = render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    rerender(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} readingDocTypes={['drivers_license']}
      />,
    )

    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
    // Inline on the card, and nowhere else.
    expect(screen.getAllByText(/reading your photo/i)).toHaveLength(1)
    expect(screen.queryByLabelText(/upload photo/i)).toBeNull()
  })

  it('stays docked after a failed first read leaves nothing behind', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)

    const { rerender } = render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    rerender(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} readingDocTypes={['drivers_license']}
      />,
    )
    rerender(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
  })

  it('floats the reading line for a read no visible card shows', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const base = createApplication('app-1', PROFILE, OWNER)
    const state = applicationReducer(base, {
      type: 'RECORD_DOCUMENT', documentId: 'doc-1',
      docType: 'drivers_license', at: AT,
    })

    render(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} readingDocTypes={['dealer_license']}
      />,
    )

    expect(screen.getByText(/reading your photo/i)).toBeInTheDocument()
  })

  it('a resumed conversation never sees the start screen', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const turn: Turn = { seq: 1, at: AT, role: 'agent', voice: 'Welcome back.', blocks: [] }
    const base = createApplication('app-1', PROFILE, OWNER)
    const state: ApplicationState = { ...base, transcript: [turn] }

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
  })

  it('runs the first action through a view transition when the platform has one', async () => {
    // Same shape as dock-transition.test.ts: the lib's own return type, so
    // the mock assigns without a cast; `delete` needs `as any` for the same
    // reason it does there — the property isn't declared optional on `Document`.
    type VTDocument = Document & { startViewTransition?: (cb: () => void) => ViewTransition }
    const doc = document as VTDocument
    const vt = vi.fn((cb: () => void) => { cb(); return {} as ViewTransition })
    doc.startViewTransition = vt
    try {
      const state = createApplication('app-1', PROFILE, OWNER)
      // A well-shaped /turn response — an unhandled rejection from a bare
      // `{}` body would otherwise fail the run despite the assertion below.
      stubFetch((call) =>
        call.url.endsWith('/turn')
          ? { status: 200, body: { state, turn: null } }
          : { status: 200, body: {} },
      )

      render(
        <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
      )
      await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
      await userEvent.click(screen.getByRole('button', { name: /send/i }))

      expect(vt).toHaveBeenCalledTimes(1)
    } finally {
      delete (doc as any).startViewTransition
    }
  })

  it('refuses to send once the application is submitted, without disabling the composer', async () => {
    const state = createApplication('app-1', PROFILE, OWNER)
    const submitted: ApplicationState = { ...state, submittedAt: AT }
    stubFetch(() => ({ status: 200, body: {} }))

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={submitted} {...noHandlers} />,
    )

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(calls.some((c) => c.url.endsWith('/turn'))).toBe(false)
  })
})
