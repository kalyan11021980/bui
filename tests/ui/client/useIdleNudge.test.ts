import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIdleNudge, NUDGE_IDLE_MS } from '@/ui/client/useIdleNudge'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** Advances past the idle window inside act, so the effect's timer fires. */
function idle(by = NUDGE_IDLE_MS) {
  act(() => { vi.advanceTimersByTime(by) })
}

describe('useIdleNudge', () => {
  it('does not fire for the writes that were already there when it mounted', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleNudge(7, true, onIdle))
    idle()
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('fires once the writes stop', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ writes }) => useIdleNudge(writes, true, onIdle),
      { initialProps: { writes: 0 } },
    )
    rerender({ writes: 1 })
    idle()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  // The panel dispatches per valid keystroke, so "Ohio" is four writes. One
  // turn per keystroke would be four model calls for one answer.
  it('coalesces a burst of writes into a single nudge', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ writes }) => useIdleNudge(writes, true, onIdle),
      { initialProps: { writes: 0 } },
    )
    for (const writes of [1, 2, 3, 4]) {
      rerender({ writes })
      act(() => { vi.advanceTimersByTime(NUDGE_IDLE_MS - 50) })
    }
    expect(onIdle).not.toHaveBeenCalled()
    idle()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while disabled, and does not fire the backlog on re-enable', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ writes, enabled }) => useIdleNudge(writes, enabled, onIdle),
      { initialProps: { writes: 0, enabled: false } },
    )
    rerender({ writes: 1, enabled: false })
    idle()
    expect(onIdle).not.toHaveBeenCalled()

    // Re-enabling is not itself a write: a submitted application that reopens
    // must not fire a turn nobody asked for.
    rerender({ writes: 1, enabled: true })
    idle()
    expect(onIdle).not.toHaveBeenCalled()

    rerender({ writes: 2, enabled: true })
    idle()
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('fires again for the next burst', () => {
    const onIdle = vi.fn()
    const { rerender } = renderHook(
      ({ writes }) => useIdleNudge(writes, true, onIdle),
      { initialProps: { writes: 0 } },
    )
    rerender({ writes: 1 })
    idle()
    rerender({ writes: 2 })
    idle()
    expect(onIdle).toHaveBeenCalledTimes(2)
  })
})
