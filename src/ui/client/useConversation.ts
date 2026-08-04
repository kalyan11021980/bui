'use client'

import { useRef, useState } from 'react'
import type { ApplicationState } from '@/domain/application/state'
import type { Turn } from '@/domain/orchestrator/transcript'
import { sendTurn } from './application-api'

export type UseConversation = {
  /** This session's turns only — see the seeding note below. */
  turns: readonly Turn[]
  pending: boolean
  send: (text: string) => void
}

/**
 * Owns the transcript shown in the chat and the one request that grows it.
 * Never seeded from `state.transcript`: §12.1 of the parent spec requires a
 * returning applicant to land on the panel with an orientation line, not a
 * replayed transcript, so `turns` starts empty and only ever gains what this
 * session itself produces. `initialState` is read once, to know which seq a
 * turn from THIS session starts after — not to backfill history.
 *
 * A turn is server-authored: `send` posts intent text and adopts whatever
 * `ApplicationState` comes back (a `setProfile` or `askFor` tool call is
 * already committed server-side by the time the response arrives) via
 * `onState`, rather than reducing anything locally the way `useApplication`
 * does for panel edits.
 *
 * `runSerialized` is `useApplication`'s own write queue (its `runSerialized`
 * field). The turn request is routed through it rather than fired directly,
 * for the same reason `readDocument` is: `applyTurn` re-reads state after its
 * model call, but that only narrows the window against a panel write that
 * has already landed — one still in flight (queued, not yet sent) is not
 * protected by it. Running the turn request through the same queue the panel
 * writes use means it is never even SENT until every write queued ahead of
 * it has been sent and answered, so the server has already seen them.
 */
export function useConversation(
  applicationId: string,
  ownerToken: string | null,
  initialState: ApplicationState,
  onState: (state: ApplicationState) => void,
  runSerialized: (run: () => Promise<void>) => void,
): UseConversation {
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [pending, setPending] = useState(false)
  const seen = useRef(initialState.transcript.length)
  const inFlight = useRef(false)
  // Turns this hook fabricates locally (a transport failure) get their own
  // key space, strictly below every real Turn.seq (which starts at 1 and
  // only grows) — so a locally-made turn can never collide with, or be
  // mistaken for, one the server produced.
  const localSeq = useRef(0)

  const send = (text: string) => {
    const trimmed = text.trim()
    if (trimmed === '' || inFlight.current) return
    inFlight.current = true
    setPending(true)

    runSerialized(async () => {
      const result = await sendTurn(applicationId, ownerToken, trimmed)
      inFlight.current = false
      setPending(false)

      if (!result.ok) {
        // `status === null` means the request never reached a server at all
        // — the one case `degraded_notice`'s wording ("I can't reach my
        // assistant") is actually true. Any other refusal (closed
        // application, wrong or unknown owner) got a real answer back, just
        // not one this vetted copy id describes, and there is no other
        // vetted copy for it — so nothing is added to the transcript rather
        // than putting the wrong words in the agent's mouth.
        if (result.status === null) {
          localSeq.current -= 1
          setTurns((held) => [...held, degradedTurn(localSeq.current)])
        }
        return
      }

      // Both the applicant's own committed turn and the agent's reply arrive
      // in one response, inside `state.transcript`; only what is new since
      // the last response (or since this session started) is shown.
      const fresh = result.value.state.transcript.filter((turn) => turn.seq > seen.current)
      seen.current = result.value.state.transcript.length
      setTurns((held) => [...held, ...fresh])
      onState(result.value.state)
    })
  }

  return { turns, pending, send }
}

function degradedTurn(seq: number): Turn {
  return {
    seq,
    at: new Date().toISOString(),
    role: 'agent',
    voice: null,
    blocks: [{ kind: 'notice', copyId: 'degraded_notice' }],
  }
}
