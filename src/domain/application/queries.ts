import { requiredFields } from '../requirements/engine'
import type { RequirementKey } from '../requirements/key'
import type { ApplicationState } from './state'

/** Statuses that satisfy a requirement. */
const SATISFIED: ReadonlySet<string> = new Set(['confirmed', 'verified'])

export function outstandingFields(state: ApplicationState): RequirementKey[] {
  return requiredFields(state.profile).filter((id) => {
    const f = state.fields[id]
    return !f || !SATISFIED.has(f.status)
  })
}

export function isComplete(state: ApplicationState): boolean {
  return outstandingFields(state).length === 0
}
