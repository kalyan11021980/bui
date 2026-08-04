import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationShell } from '@/ui/chat/ConversationShell'
import type { BlockHandlers } from '@/ui/chat/blocks'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Turn } from '@/domain/orchestrator/transcript'
import { sendAction } from '@/ui/client/application-api'

/**
 * The shell against a stubbed server. The most important test here is the
 * last one: a keystroke inside a field_ask control must reach the panel's
 * own write path (`/actions`) and never the turn endpoint (`/turn`) — the §4
 * guarantee, at the UI layer.
 */

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

const noHandlers: BlockHandlers & { onState: (state: ApplicationState) => void } = {
  onChange: () => undefined,
  onClear: () => undefined,
  onReadDocument: () => undefined,
  onState: () => undefined,
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('ConversationShell', () => {
  it('renders the opening beat before any turn exists, with no fetch at all', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.getByText(/I'm your registration agent/i)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('cannot render the opening beat via a model call — the copy is local, not fetched', () => {
    // A provider that never resolves would leave the beat missing forever if
    // it were gated on a turn. Never letting fetch settle proves it is not.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    const state = createApplication('app-1', PROFILE, OWNER)

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.getByText(/I'm your registration agent/i)).toBeInTheDocument()
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
})
