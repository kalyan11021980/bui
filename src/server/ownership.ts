import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { ApplicationState } from '@/domain/application/state'

/**
 * A capability token, not authentication. There is no login, no session and
 * nobody's identity behind it — all it does is stop an application id from
 * being enough on its own to read a taxpayer ID or a date of birth.
 *
 * TODO(phase-4): a real authenticated session, once there is somewhere to
 * keep an account.
 */

/** The header the browser sends it back in. */
export const OWNER_TOKEN_HEADER = 'x-owner-token'

export function newOwnerToken(): string {
  return randomUUID()
}

export function ownerTokenOf(request: Request): string | null {
  return request.headers.get(OWNER_TOKEN_HEADER)
}

export function ownsApplication(
  state: ApplicationState,
  presented: string | null,
): boolean {
  // A stored token is always a string; the null case is here so a record that
  // somehow lacks one fails closed rather than matching a caller who sent none.
  if (presented === null || state.ownerToken === null) return false
  return sameToken(state.ownerToken, presented)
}

/** What every response but the creation one is allowed to say. */
export function withoutOwnerToken(state: ApplicationState): ApplicationState {
  return { ...state, ownerToken: null }
}

function sameToken(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  // timingSafeEqual throws on a length mismatch, and comparing lengths first
  // leaks only the length.
  return a.length === b.length && timingSafeEqual(a, b)
}
