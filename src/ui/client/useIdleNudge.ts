'use client'

import { useEffect, useRef } from 'react'

/**
 * How long the panel must be quiet before the agent is told to move on.
 * The panel dispatches on every keystroke its schema accepts, so this is
 * what turns an answer being typed into one turn rather than one per letter.
 */
export const NUDGE_IDLE_MS = 1200

/**
 * Calls `onIdle` once the applicant stops writing in the panel.
 *
 * Panel answers never travel through the agent — they go straight to the
 * store — so without this the agent has no way to know an answer landed, and
 * sits silent until the applicant types something at it. Which is what made
 * "done" a magic word.
 *
 * `writes` is a monotonic count of panel writes; only a change in it arms the
 * timer. Mounting does not, and neither does `enabled` flipping on, so no turn
 * is ever fired by something other than the applicant answering something.
 */
export function useIdleNudge(
  writes: number,
  enabled: boolean,
  onIdle: () => void,
): void {
  const seen = useRef(writes)
  // Held in a ref so a caller passing a fresh closure each render re-arms
  // nothing — the timer belongs to the write, not to the render.
  const latest = useRef(onIdle)
  latest.current = onIdle

  useEffect(() => {
    if (writes === seen.current) return
    seen.current = writes
    if (!enabled) return

    const timer = setTimeout(() => latest.current(), NUDGE_IDLE_MS)
    return () => clearTimeout(timer)
  }, [writes, enabled])
}
