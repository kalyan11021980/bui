import { flushSync } from 'react-dom'

/**
 * Instant swap under reduced motion or without the API; flushSync puts the
 * new layout in the DOM inside the transition's snapshot window.
 */
export function withViewTransition(update: () => void): void {
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  const transition = document.startViewTransition(() => { flushSync(update) })
  // A skipped animation (hidden tab, concurrent transition) rejects these;
  // the update itself still ran, so there is nothing to recover.
  transition.ready.catch(() => undefined)
  transition.finished.catch(() => undefined)
  // A throwing update rejects this one too — same reasoning.
  transition.updateCallbackDone.catch(() => undefined)
}
