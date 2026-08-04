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
  /** Null until the application has started; the composer stays disabled. */
  ownerToken: string | null
  state: ApplicationState
  /** Adopts the state a completed turn returned — a `setProfile` or `askFor`
   *  tool call is already committed server-side by the time it arrives. */
  onState: (state: ApplicationState) => void
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
  applicationId, ownerToken, state, onChange, onClear, onReadDocument, onState,
}: Props) {
  const { turns, pending, send } = useConversation(applicationId, ownerToken, state, onState)
  const [draft, setDraft] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
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
          disabled={pending || ownerToken === null}
          onChange={(event) => setDraft(event.target.value)}
          style={composerStyle}
        />
        <button
          type="submit"
          disabled={pending || ownerToken === null || draft.trim() === ''}
          style={{
            background: COLOR.primary, color: COLOR.surface, border: 'none',
            padding: '6px 14px', cursor: 'pointer',
          }}
        >
          Send
        </button>
      </form>
    </section>
  )
}
