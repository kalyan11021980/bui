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

/**
 * Thrown when an action would change an application that has already been
 * sent for review. Its own class, not a bare Error, so the route can answer
 * with 409 Conflict — "the state moved on" — rather than 422, which invites a
 * caller to retry with a better value when no value will be accepted.
 */
export class ApplicationSubmittedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApplicationSubmittedError'
  }
}

/**
 * Why this application refuses to change, or null if it does not.
 *
 * Both the condition and the wording live here, so the reducer's throw and
 * the route's 409 cannot drift into disagreeing about when an application is
 * closed or what to tell the person who found out. The message names the
 * time, because "you cannot do that" with no reason is the greyed-out button
 * in a different costume, and it names who to ask, because from the
 * applicant's side there is no self-service way out of this state.
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
 * Every action is refused once `submittedAt` is set — including VERIFY and
 * REJECT, which are reviewer verbs rather than applicant ones. Phase 1 has no
 * authentication at all (see the route's phase-2 TODO), so accepting a
 * reviewer verb here would mean anyone holding the id could mark a submitted
 * KYC record verified. Refusing everything is the only honest position until
 * there is someone to attribute the verb to.
 *
 * TODO(phase-4): the repair loop. The spec puts re-opening in phase 4, driven
 * by a REVIEWER's rejection on an authenticated path — never by the applicant
 * deciding to keep typing. That is where VERIFY, REJECT and a re-open
 * transition come back, with an actor recorded on each.
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
  // Before the switch, so no action can be added later that quietly escapes
  // it. Enforced HERE rather than in the route so the client path is covered
  // by the same rule: an invariant that only one caller honours is not an
  // invariant (§8.2).
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
        // A value the user typed is confirmed by the act of typing it.
        // A value we derived still needs their eyes on it. Spec §9.1.
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
      // Clearing what was never recorded is not an error, it is the state the
      // caller asked for. Returning `state` itself keeps a no-op cheap and
      // keeps carry's `applied` list honest about what actually happened.
      if (!current || current.value === null) return state
      // Provenance goes with the value. "Read from your license, high
      // confidence" describing a value that is gone is a lie about the
      // record, and provenance is what a reviewer reads to decide how hard
      // to look. Any rejection goes too: it was about the old value.
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
      // A second submission is refused by `refuseIfSubmitted` above, together
      // with every other mutation, rather than by a rule of its own here.
      const outstanding = outstandingFields(state)
      if (outstanding.length > 0) {
        // §8.2: reject any completion attempt while requirements remain. The
        // message names them, because "cannot submit" with no reason is the
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
 * Brings stored fields back into line with what the new profile requires.
 *
 * Dropping a licence from two to one used to leave `license_number#1` sitting
 * in `state.fields`: invisible to the panel and to `outstandingFields`, but
 * still persisted and still in the audit trail — a licence number the
 * applicant believes they removed. Spec §8.5 specifies `superseded` for
 * exactly this, and both the status and the SUPERSEDE action already existed
 * with nothing dispatching them.
 *
 * The reverse direction matters too: adding the licence back must not leave a
 * required field stuck in a status that no longer describes it. A superseded
 * field that becomes required again returns to `derived`, which is to say
 * "we still have this, please look at it again" rather than silently counting
 * as answered.
 *
 * Values are never deleted — the trail is append-only and so, in spirit, is
 * this. Only the status changes.
 *
 * The supersession is not separately audited: it is a deterministic function
 * of the profile change, which IS audited (patch, since I3) together with the
 * application's rulesVersion, so the trail can reproduce it. Only the resume
 * path — an application reopened after `RULES_VERSION` itself moves — remains
 * deferred to phase 4.
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
