import { flushSync } from 'react-dom'

/**
 * Runs a layout-flipping update through the View Transitions API where the
 * platform has it — an instant swap under reduced motion or without the API.
 * flushSync is what puts the new layout in the DOM inside the transition's
 * snapshot window.
 */
export function withViewTransition(update: () => void): void {
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  document.startViewTransition(() => { flushSync(update) })
}
