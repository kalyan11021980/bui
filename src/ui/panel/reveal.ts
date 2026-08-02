'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { fieldInputId } from './FieldInput'

/**
 * Brings one field into view and puts the caret in it.
 *
 * Used by the carry acknowledgement ("Also filled in: Business address ↓")
 * and by "Fix this", which are the same request: the applicant has been told
 * something happened somewhere else and wants to go and look at it.
 *
 * Deliberately unanimated beyond the scroll itself. A reduced-motion
 * preference is honoured rather than overridden — a smooth scroll is exactly
 * the vestibular trigger that setting exists for — and `scrollIntoView` is
 * feature-detected because jsdom does not implement it, so a test asserting
 * the FOCUS half must not die on the scroll half.
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
