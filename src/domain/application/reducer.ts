import type { RequirementKey } from '../requirements/key'
import { requiredFields } from '../requirements/engine'
import { RULES_VERSION } from '../requirements/version'
import type { Action, ApplicationState, FieldState } from './state'
import type { ApplicantProfile } from '../requirements/rules'

export function createApplication(
  id: string,
  profile: ApplicantProfile,
): ApplicationState {
  return {
    id,
    rulesVersion: RULES_VERSION,
    profile,
    fields: {},
    submittedAt: null,
  }
}

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
function refuseIfSubmitted(state: ApplicationState): void {
  const refusal = submittedRefusal(state)
  if (refusal !== null) throw new ApplicationSubmittedError(refusal)
}

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

export function applicationReducer(
  state: ApplicationState,
  action: Action,
): ApplicationState {
  // Before the switch, so an action added later cannot escape it. Here rather
  // than in the route so the client path is covered by the same rule.
  refuseIfSubmitted(state)

  switch (action.type) {
    case 'SET_VALUE': {
      if (action.source === 'carried' && action.fromFieldId === undefined) {
        throw new Error(
          `Cannot carry into "${action.fieldId}": a carried value must record where it came from`,
        )
      }
      const next: FieldState = {
        value: action.value,
        // Typing it is confirming it; anything we derived still needs eyes.
        status: action.source === 'user' ? 'confirmed' : 'derived',
        provenance: {
          source: action.source,
          ...(action.documentId !== undefined && { documentId: action.documentId }),
          ...(action.box !== undefined && { box: action.box }),
          ...(action.confidence !== undefined && { confidence: action.confidence }),
          ...(action.fromFieldId !== undefined && { fromFieldId: action.fromFieldId }),
        },
      }
      return withField(state, action.fieldId, next)
    }

    case 'CLEAR_VALUE': {
      const current = state.fields[action.fieldId]
      // Clearing what was never recorded is a no-op, not an error.
      if (!current || current.value === null) return state
      // Provenance and rejection go with the value — both described the old
      // one, and a reviewer reads provenance to decide how hard to look.
      return withField(state, action.fieldId, { value: null, status: 'empty' })
    }

    case 'CONFIRM': {
      const current = requireField(state, action.fieldId, 'confirm', { withValue: true })
      return withField(state, action.fieldId, {
        ...current,
        status: 'confirmed',
      })
    }

    case 'VERIFY': {
      const current = requireField(state, action.fieldId, 'verify')
      return withField(state, action.fieldId, { ...current, status: 'verified' })
    }

    case 'REJECT': {
      const current = requireField(state, action.fieldId, 'reject')
      return withField(state, action.fieldId, {
        ...current,
        status: 'rejected',
        rejection: { reason: action.reason, at: action.at },
      })
    }

    case 'SUPERSEDE': {
      const current = requireField(state, action.fieldId, 'supersede')
      return withField(state, action.fieldId, {
        ...current,
        status: 'superseded',
      })
    }

    case 'UPDATE_PROFILE': {
      const profile: ApplicantProfile = { ...state.profile, ...action.patch }
      return { ...state, profile, fields: resyncFields(state, profile) }
    }

    case 'SUBMIT': {
      const outstanding = outstandingFields(state)
      if (outstanding.length > 0) {
        // Names what is missing: "cannot submit" with no reason is the
        // greyed-out button in a different costume.
        throw new Error(
          `Cannot submit: ${outstanding.length} still outstanding — ${outstanding.join(', ')}`,
        )
      }
      return { ...state, submittedAt: action.at }
    }
  }
}

/**
 * Brings stored fields back into line with what the new profile requires: no
 * longer required becomes `superseded`, required again returns to `derived`
 * ("we still have this, look at it again") rather than counting as answered.
 *
 * Values are never deleted, only restatused. The supersession is not audited
 * separately — it is a deterministic function of the profile change, which is
 * audited together with rulesVersion.
 *
 * TODO(phase-4): resync on resume, when RULES_VERSION itself has moved.
 */
function resyncFields(
  state: ApplicationState,
  profile: ApplicantProfile,
): ApplicationState['fields'] {
  const required = new Set(requiredFields(profile))
  const next: ApplicationState['fields'] = { ...state.fields }

  for (const [key, field] of Object.entries(state.fields)) {
    if (!field) continue

    if (!required.has(key) && field.status !== 'superseded') {
      next[key] = { ...field, status: 'superseded' }
    } else if (required.has(key) && field.status === 'superseded' && field.value !== null) {
      next[key] = { ...field, status: 'derived' }
    }
  }

  return next
}

function requireField(
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

function withField(
  state: ApplicationState,
  id: RequirementKey,
  field: FieldState,
): ApplicationState {
  return { ...state, fields: { ...state.fields, [id]: field } }
}
