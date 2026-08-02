import type { RequirementKey } from '../requirements/key'
import type { ApplicationState, FieldState } from './state'

/** Its own class so the route can answer 409 rather than 422. */
export class ApplicationSubmittedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApplicationSubmittedError'
  }
}

/**
 * Why this application refuses to change, or null if it does not. Shared by
 * the reducer's throw and the route's 409 so the two cannot disagree.
 */
export function submittedRefusal(state: ApplicationState): string | null {
  if (state.submittedAt === null) return null
  return (
    `This application was sent for review on ${state.submittedAt} and can no `
    + 'longer be changed. Buyer Services will be in touch if anything needs '
    + 'correcting.'
  )
}

/**
 * Refuses every action once `submittedAt` is set, including the reviewer
 * verbs VERIFY and REJECT — phase 1 has no authentication, so anyone holding
 * the id could otherwise mark a submitted KYC record verified.
 *
 * TODO(phase-4): re-open transition, driven by a reviewer on an authenticated
 * path, which is when VERIFY and REJECT come back with an actor recorded.
 */
export function refuseIfSubmitted(state: ApplicationState): void {
  const refusal = submittedRefusal(state)
  if (refusal !== null) throw new ApplicationSubmittedError(refusal)
}

export function requireField(
  state: ApplicationState,
  id: RequirementKey,
  verb: string,
  opts: { withValue?: boolean } = {},
): FieldState {
  const f = state.fields[id]
  if (!f) throw new Error(`Cannot ${verb} "${id}": it has no value yet`)
  if (opts.withValue && f.value === null) {
    throw new Error(`Cannot ${verb} "${id}": it has no value yet`)
  }
  return f
}
