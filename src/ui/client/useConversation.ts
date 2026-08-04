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
 */
export function useConversation(
  applicationId: string,
  ownerToken: string | null,
  initialState: ApplicationState,
  onState: (state: ApplicationState) => void,
): UseConversation {
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [pending, setPending] = useState(false)
  const seen = useRef(initialState.transcript.length)
  const inFlight = useRef(false)

  const send = (text: string) => {
    const trimmed = text.trim()
    if (trimmed === '' || inFlight.current) return
    inFlight.current = true
    setPending(true)

    void sendTurn(applicationId, ownerToken, trimmed).then((result) => {
      inFlight.current = false
      setPending(false)

      if (!result.ok) {
        // Never reached a server, or was refused outright (closed, unknown).
        // A vetted notice, same as a degraded model turn — no retry storm,
        // no error the applicant did not write.
        setTurns((held) => [...held, degradedTurn(seen.current + held.length + 1)])
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
