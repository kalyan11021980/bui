'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { fieldInputId } from './FieldControl'

/**
 * Brings one field into view and puts the caret in it. `scrollIntoView` is
 * feature-detected because jsdom does not implement it, so a test asserting
 * the focus half does not die on the scroll half.
 */
export function revealField(fieldId: RequirementKey): void {
  const element = document.getElementById(fieldInputId(fieldId))
  if (!element) return

  if (typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    })
  }
  element.focus()
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
