import { randomUUID } from 'node:crypto'
import { applyCarry } from '@/domain/application/carry'
import {
  ApplicationSubmittedError, submittedRefusal,
} from '@/domain/application/guards'
import {
  applicationReducer, createApplication as newApplication,
} from '@/domain/application/reducer'
import { getAuditLog } from '@/server/audit'
import { getApplication as loadApplication, putApplication } from '@/server/store'
import { checkAgainstRequirements } from './action-guard'
import { failure, type Failure } from './http'
import type { Action, ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure }

/**
 * What a new application starts as. UPDATE_PROFILE moves it from here; the
 * panel does not yet ask up front.
 */
const STARTING_PROFILE: ApplicantProfile = {
  applicantType: 'individual',
  country: 'US',
  state: null,
  wantsGsa: false,
  licenses: [],
}

/**
 * The id is generated here rather than accepted from the caller, so ids are
 * not enumerable — the response carries `tax_id.value`.
 *
 * TODO(phase-2): no ownership check. Knowing an id is enough to read every
 * value in the application, including tax_id and dob. Needs an authenticated
 * session and an owner recorded at creation.
 */
export function createApplication(): ApplicationState {
  const created = newApplication(randomUUID(), STARTING_PROFILE)
  putApplication(created)
  return created
}

export function getApplication(id: string): Result<ApplicationState> {
  const existing = loadApplication(id)
  if (!existing) return { ok: false, failure: failure('unknown', 'unknown application') }
  return { ok: true, value: existing }
}

export function applyAction(id: string, action: Action): Result<ApplicationState> {
  const current = loadApplication(id)
  if (!current) return { ok: false, failure: failure('unknown', 'unknown application') }

  // Ahead of the requirements check, so a closed application answers 409
  // whatever the action carries rather than 422 "fix the value and retry".
  const closed = submittedRefusal(current)
  if (closed !== null) return { ok: false, failure: failure('submitted', closed) }

  const refusal = checkAgainstRequirements(current, action)
  if (refusal) return { ok: false, failure: failure('rejected', refusal) }

  try {
    return { ok: true, value: commit(current, action) }
  } catch (error) {
    if (error instanceof ApplicationSubmittedError) {
      return { ok: false, failure: failure('submitted', error.message) }
    }
    // The reducer signals a rejected request by throwing; that is a 422, not
    // a 500 with a stack trace.
    return {
      ok: false,
      failure: failure('rejected', error instanceof Error ? error.message : 'Action rejected'),
    }
  }
}

/**
 * Carry runs on this path because it is the only write path. Auditing happens
 * before the store is updated, so an append that throws leaves the previous
 * state in place rather than a mutation with no trail entry.
 */
function commit(current: ApplicationState, action: Action): ApplicationState {
  const log = getAuditLog()
  const reduced = applicationReducer(current, action)
  const carried = applyCarry(reduced, action.at)

  log.append(current.id, action)
  for (const carriedAction of carried.applied) log.append(current.id, carriedAction)

  putApplication(carried.state)
  return carried.state
}
