'use client'

import { useState } from 'react'
import type { ApplicationState } from '@/domain/application/state'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { useConversation } from '@/ui/client/useConversation'
import { COLOR } from '@/ui/theme/tokens'
import type { BlockHandlers } from './blocks'
import { TurnView } from './TurnView'

type Props = BlockHandlers & {
  applicationId: string
  /** Null until the application has started; sending stays disabled. */
  ownerToken: string | null
  state: ApplicationState
  /** Adopts the state a completed turn returned — a `setProfile` or `askFor`
   *  tool call is already committed server-side by the time it arrives. */
  onState: (state: ApplicationState) => void
  /**
   * `useApplication`'s own write queue. The turn request is routed through
   * it — see `useConversation`'s own comment for why a whole-state adoption
   * needs the same ordering guarantee `readDocument` already relies on it for.
   */
  runSerialized: (run: () => Promise<void>) => void
}

const openingStyle: React.CSSProperties = {
  margin: '4px 0', fontSize: 15, color: COLOR.textPrimary,
}

const composerStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 15,
  color: COLOR.textPrimary, background: COLOR.surface, border: `1px solid ${COLOR.border}`,
}

/**
 * The opening beat, the turns, the composer. The opening beat is fixed
 * vetted copy — no turn, no fetch — so a cold or unreachable model never
 * costs the applicant the introduction; everything below it comes from
 * `useConversation`.
 */
export function ConversationShell({
  applicationId, ownerToken, state, onChange, onClear, onReadDocument, onState, runSerialized,
}: Props) {
  const { turns, pending, send } = useConversation(
    applicationId, ownerToken, state, onState, runSerialized,
  )
  const [draft, setDraft] = useState('')
  const closed = state.submittedAt !== null
  // Neither element below is ever given the `disabled` attribute: disabling
  // an element that holds focus moves focus to <body> and nothing restores
  // it (§9.1 — "focus is never stolen by an update"). Sending is refused
  // here instead, so the control stays focusable throughout.
  const sendable = !pending && ownerToken !== null && !closed

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!sendable) return
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    send(text)
  }

  return (
    <section aria-label="Registration agent" style={{ maxWidth: 560, marginTop: 16 }}>
      {vettedCopy('opening_beat').split('\n\n').map((paragraph, index) => (
        <p key={index} style={openingStyle}>{paragraph}</p>
      ))}

      {/* Polite and coalesced, per §9.1: a turn arriving must not interrupt
          whatever the applicant is doing, and must never steal focus. */}
      <div role="log" aria-live="polite" aria-relevant="additions">
        {turns.map((turn) => (
          <TurnView
            key={turn.seq}
            turn={turn}
            state={state}
            onChange={onChange}
            onClear={onClear}
            onReadDocument={onReadDocument}
          />
        ))}
      </div>

      <form onSubmit={submit} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <label htmlFor="chat-composer" style={{ position: 'absolute', left: -9999 }}>
          Tell the agent something
        </label>
        <input
          id="chat-composer"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          style={composerStyle}
        />
        <button
          type="submit"
          aria-disabled={!sendable || draft.trim() === ''}
          style={{
            background: COLOR.primary, color: COLOR.surface, border: 'none',
            padding: '6px 14px', cursor: 'pointer',
            opacity: !sendable || draft.trim() === '' ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </form>
    </section>
  )
}
