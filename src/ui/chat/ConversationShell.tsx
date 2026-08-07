'use client'

import { useEffect, useRef } from 'react'
import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { lastPresentedSectionTurn } from '@/domain/orchestrator/plan'
import type { RequirementKey } from '@/domain/requirements/key'
import { useConversation } from '@/ui/client/useConversation'
import type { BlockHandlers } from './blocks'
import { CompletionCard } from './CompletionCard'
import { Composer } from './Composer'
import { withViewTransition } from './dock-transition'
import { OpeningUploadCard, visibleCardDocType } from './OpeningUploadCard'
import { SectionDoneBar } from './SectionDoneBar'
import { StartScreen } from './StartScreen'
import { StatusLine, READING_PHOTO } from './StatusLine'
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
  /** The same submit the panel uses — the CompletionCard is just a second door to it. */
  onSubmit: () => void
  /** Adopts the state a completed turn returned — a `setProfile` or
   *  `requestDocument` tool call is already committed server-side by the
   *  time it arrives. */
  onState: (state: ApplicationState) => void
  /**
   * `useApplication`'s own write queue. The turn request is routed through
   * it — see `useConversation`'s own comment for why a whole-state adoption
   * needs the same ordering guarantee `readDocument` already relies on it for.
   */
  runSerialized: (run: () => Promise<void>) => void
  /** Doc types with a read in flight — queued or fetching. */
  readingDocTypes: readonly DocType[]
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

/**
 * Flex-grow column, shared by the docked content wrapper and the log inside
 * it — both need to grow the same way so the sticky composer stays pinned
 * below whatever is on screen.
 */
const growStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
}

/** The start screen centres the same column instead of growing a log. Padding
 *  uses the shorthand here too, matching shellStyle — mixing shorthand and
 *  longhand for the same property across the flip makes React drop
 *  properties mid-rerender and warn. */
const startShellStyle: React.CSSProperties = {
  ...shellStyle, justifyContent: 'center', padding: '24px 20px',
}

/**
 * Centered start screen before the first action, docked conversation after.
 * The greeting is fixed vetted copy — no turn, no fetch — so a cold or
 * unreachable model never costs the applicant the introduction; everything
 * past the dock comes from `useConversation`.
 */
export function ConversationShell({
  applicationId, ownerToken, state, onSubmit, onChange, onClear, onConfirm, onReadDocument, onState, runSerialized,
  readingDocTypes,
}: Props) {
  const { turns, pending, send, sendDone, ingest } = useConversation(
    applicationId, ownerToken, state, onState, runSerialized,
  )
  // Picks up a turn that arrived outside `send`/`sendDone` — an upload's
  // response. Keyed on the transcript's own length rather than `state` or
  // `ingest` itself, since neither is stable across a render that changed
  // nothing else here.
  const transcriptLength = state.transcript.length
  useEffect(() => {
    ingest(state)
  }, [transcriptLength]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on length on purpose
  // Brings a newly arrived turn into view — its start, so a long answer is
  // read from the top. scrollIntoView never moves focus, so §9.1 holds; the
  // motion itself honours the reduced-motion preference.
  const logRef = useRef<HTMLDivElement>(null)
  const lastSeq = turns.length > 0 ? turns[turns.length - 1]?.seq : undefined
  useEffect(() => {
    if (lastSeq === undefined) return
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    logRef.current?.lastElementChild?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth', block: 'start',
    })
  }, [lastSeq])
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

  // The Done control is part of the section group that last presented — the
  // same turn bubble that holds its section_header. When that turn is in this
  // session's log it rides as the bubble's trailing slot; when it is
  // committed-only (a resume with an empty log, §12.1) it falls back to
  // standing alone after the log. SectionDoneBar owns the visibility gates
  // (submitted / nothing outstanding / panel-only), so exactly one instance
  // renders either way.
  const activeGroup = lastPresentedSectionTurn([...state.transcript, ...turns])
  const activeInLog = activeGroup !== null && turns.some((t) => t.seq === activeGroup.seq)
  const doneBar = <SectionDoneBar state={state} turns={turns} sendable={sendable} onDone={sendDone} />

  const startedNow = turns.length > 0 || state.transcript.length > 0
    || state.documents.length > 0 || readingDocTypes.length > 0 || pending
    || state.submittedAt !== null
  // Latches: a failed first read — nothing committed, nothing pending — must
  // not un-dock the screen (spec §1).
  const startedRef = useRef(startedNow)
  if (startedNow) startedRef.current = true
  const started = startedRef.current

  // First action docks the layout, animated where the platform allows.
  // Composer refuses empty drafts before onSend, so a blank send never docks.
  // Stays animated only because nothing here calls shell-level setState
  // between the latch and the transition's flushSync callback below —
  // Composer's own local state (its draft) is fine, but a shell setState on
  // the same click would land outside the transition's snapshot and the
  // flip would silently stop animating.
  const dockOn = <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (startedRef.current) { fn(...args); return }
      startedRef.current = true
      withViewTransition(() => fn(...args))
    }
  const sendDocking = dockOn(send)
  const readDocking = dockOn(onReadDocument)

  // A read shown on the visible card is not repeated as a floating line.
  const cardDocType = visibleCardDocType(state)
  const floatingReads = readingDocTypes.filter((t) => t !== cardDocType)

  return (
    <section aria-label="Registration agent" style={started ? shellStyle : startShellStyle}>
      <div style={started ? growStyle : undefined}>
        {started ? (
          <>
            <OpeningUploadCard
              state={state} onReadDocument={readDocking} readingDocTypes={readingDocTypes}
            />

            {/* Polite and coalesced, per §9.1: a turn arriving must not interrupt
                whatever the applicant is doing, and must never steal focus. */}
            <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" style={growStyle}>
              {turns.map((turn) => (
                <TurnView
                  key={turn.seq}
                  turn={turn}
                  state={state}
                  onChange={blockChange}
                  onClear={blockClear}
                  onConfirm={blockConfirm}
                  onReadDocument={readDocking}
                  trailing={activeInLog && turn.seq === activeGroup?.seq ? doneBar : undefined}
                />
              ))}
            </div>

            {/* The OCR read is multi-second and otherwise silent. Only reads no
                visible card is already showing land here. */}
            {floatingReads.length > 0 && <StatusLine text={READING_PHOTO} />}

            {/* The agent's slot, held while it thinks. Not a spinner for its own
                sake: a turn is one to ten seconds, and an empty screen after the
                composer clears reads as an app that dropped what you said. */}
            {pending && <StatusLine text="Thinking…" />}

            {activeGroup !== null && !activeInLog && doneBar}

            <CompletionCard state={state} onSubmit={onSubmit} />
          </>
        ) : (
          <StartScreen
            state={state}
            fieldIds={suggestible}
            disabled={!sendable}
            onPick={sendDocking}
            onReadDocument={readDocking}
            readingDocTypes={readingDocTypes}
          />
        )}
      </div>

      <div
        className={started ? 'sticky bottom-0 flex flex-col gap-2 bg-page pb-5' : 'mt-5'}
        style={{ viewTransitionName: 'composer' }}
      >
        {/* Load-bearing slot contract: Composer must stay the second child
            here (false at index 0, Composer at index 1) across the flip.
            A conditional that changes the CHILD COUNT instead of swapping
            `false` for an element would remount Composer and drop focus. */}
        {started && (
          <Suggestions fieldIds={suggestible} disabled={!sendable} onPick={sendDocking} />
        )}
        <Composer
          size={started ? 'docked' : 'hero'}
          sendable={sendable}
          onSend={sendDocking}
          state={state}
          onReadDocument={readDocking}
        />
      </div>
    </section>
  )
}
