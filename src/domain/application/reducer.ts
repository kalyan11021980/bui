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
      if (state.submittedAt !== null) {
        throw new Error(`Application "${state.id}" was already submitted at ${state.submittedAt}`)
      }
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
