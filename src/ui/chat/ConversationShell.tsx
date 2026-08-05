'use client'

import { useState } from 'react'
import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import { vettedCopy } from '@/domain/orchestrator/copy'
import type { RequirementKey } from '@/domain/requirements/key'
import { useConversation } from '@/ui/client/useConversation'
import { useIdleNudge } from '@/ui/client/useIdleNudge'
import { COLOR } from '@/ui/theme/tokens'
import type { BlockHandlers } from './blocks'
import { OpeningUploadCard } from './OpeningUploadCard'
import { Suggestions } from './Suggestions'
import { TurnView } from './TurnView'

/** Stable references, so a no-op swap is not a re-render on every keystroke. */
const NOOP_CHANGE = (_id: RequirementKey, _value: unknown): void => undefined
const NOOP_CLEAR = (_id: RequirementKey): void => undefined
const NOOP_CONFIRM = (_id: RequirementKey): void => undefined

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
  /** See `useIdleNudge` — what tells the agent an answer landed in the panel. */
  panelWrites: number
}

/**
 * A centred, readable column with the composer pinned under it, rather than
 * a 560px block flush against the left edge of a 2560px window.
 */
const shellStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 680,
  margin: '0 auto', minHeight: '100vh', padding: '24px 20px 0',
  boxSizing: 'border-box',
}

/** Grows with the conversation; the composer below it never moves off-screen. */
const logStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
}

/**
 * Suggestions and composer travel together. Sticky separately, the composer
 * scrolled over the chips and cut the last one in half.
 */
const footerStyle: React.CSSProperties = {
  position: 'sticky', bottom: 0, display: 'flex', flexDirection: 'column',
  gap: 8, paddingBottom: 20, background: COLOR.page,
}

const composerRowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, margin: 0,
}

const composerStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: 15,
  color: COLOR.textPrimary, background: COLOR.surface,
  border: `1px solid ${COLOR.border}`, borderRadius: 20,
}

/**
 * The opening beat, the turns, the composer. The opening beat is fixed
 * vetted copy — no turn, no fetch — so a cold or unreachable model never
 * costs the applicant the introduction; everything below it comes from
 * `useConversation`.
 */
export function ConversationShell({
  applicationId, ownerToken, state, onChange, onClear, onConfirm, onReadDocument, onState, runSerialized, panelWrites,
}: Props) {
  const { turns, pending, send, nudge } = useConversation(
    applicationId, ownerToken, state, onState, runSerialized,
  )
  const [draft, setDraft] = useState('')
  const closed = state.submittedAt !== null
  // A field_ask block from an earlier turn stays on screen after submission —
  // history is not pruned — and the reducer refuses every change once
  // submitted. Left unguarded, reopening one of those old boxes would throw
  // instead of doing nothing, the same hazard the panel avoids by dropping
  // its own onChange/onClear once closed.
  const blockChange = closed ? NOOP_CHANGE : onChange
  const blockClear = closed ? NOOP_CLEAR : onClear
  const blockConfirm = closed ? NOOP_CONFIRM : onConfirm
  // Neither element below is ever given the `disabled` attribute: disabling
  // an element that holds focus moves focus to <body> and nothing restores
  // it (§9.1 — "focus is never stolen by an update"). Sending is refused
  // here instead, so the control stays focusable throughout.
  const sendable = !pending && ownerToken !== null && !closed
  const suggestible = outstandingFields(state)

  // Nothing outstanding means nothing for the agent to move on to — and a
  // field already asked this session is an open box on screen, so a nudge
  // that could only re-ask it would just render a second copy. Only an
  // outstanding field the agent has not asked yet is worth a turn.
  const askedOnScreen = new Set(turns.flatMap((turn) =>
    turn.role === 'agent'
      ? turn.blocks.flatMap((b) => (b.kind === 'field_ask' ? [b.fieldId] : []))
      : [],
  ))
  const worthNudging = suggestible.some((id) => !askedOnScreen.has(id))
  useIdleNudge(panelWrites, sendable && worthNudging, nudge)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!sendable) return
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    send(text)
  }

  return (
    <section aria-label="Registration agent" style={shellStyle}>
      {vettedCopy('opening_beat').split('\n\n').map((paragraph, index) => (
        <p key={index} className="mb-3 text-[15px] leading-relaxed">{paragraph}</p>
      ))}

      <OpeningUploadCard state={state} onReadDocument={onReadDocument} />

      {/* Polite and coalesced, per §9.1: a turn arriving must not interrupt
          whatever the applicant is doing, and must never steal focus. */}
      <div role="log" aria-live="polite" aria-relevant="additions" style={logStyle}>
        {turns.map((turn) => (
          <TurnView
            key={turn.seq}
            turn={turn}
            state={state}
            onChange={blockChange}
            onClear={blockClear}
            onConfirm={blockConfirm}
            onReadDocument={onReadDocument}
          />
        ))}
      </div>

      {/* The agent's slot, held while it thinks. Not a spinner for its own
          sake: a turn is one to ten seconds, and an empty screen after the
          composer clears reads as an app that dropped what you said. */}
      {pending && (
        <p role="status" className="my-2 text-[13px] text-text-secondary">
          <span aria-hidden="true" style={{ letterSpacing: 2 }}>•••</span>{' '}
          Thinking…
        </p>
      )}

      <div style={footerStyle}>
        <Suggestions
          fieldIds={suggestible}
          disabled={!sendable}
          onPick={send}
        />

        <form onSubmit={submit} style={composerRowStyle}>
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
            padding: '6px 18px', borderRadius: 20, cursor: 'pointer',
            opacity: !sendable || draft.trim() === '' ? 0.6 : 1,
          }}
        >
            Send
          </button>
        </form>
      </div>
    </section>
  )
}
