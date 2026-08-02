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

    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.patch } }
  }
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
