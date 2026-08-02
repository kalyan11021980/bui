import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  applicationReducer, ApplicationSubmittedError, createApplication,
  submittedRefusal,
} from '@/domain/application/reducer'
import { applyCarry } from '@/domain/application/carry'
import {
  describeZodError, requestBodySchema, toAction,
} from '@/domain/application/action-schema'
import { getApplication, putApplication } from '@/server/store'
import { getAuditLog } from '@/server/audit'
import { CATALOG, fieldDef } from '@/domain/catalog'
import { requiredFields } from '@/domain/requirements/engine'
import { parseReqKey } from '@/domain/requirements/key'
import type { Action, ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

/**
 * With no `id`, creates a new application and returns it. With an `id`,
 * returns that application, or 404.
 *
 * TODO(phase-2): no ownership check — knowing an id is enough to read every
 * value in the application, including tax_id and dob. Needs an authenticated
 * session and an owner recorded at creation.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')

  if (id) {
    const existing = getApplication(id)
    if (!existing) return fail(404, 'unknown application')
    return NextResponse.json(existing)
  }

  const profile: ApplicantProfile = {
    applicantType: 'individual',
    country: 'US',
    state: null,
    wantsGsa: false,
    licenses: [],
  }
  const created = createApplication(randomUUID(), profile)
  putApplication(created)
  return NextResponse.json(created)
}

/**
 * 400 malformed, 404 unknown, 409 submitted, 422 well-formed but not allowed.
 * Every action is re-validated here, not just in the panel — phase 3 puts an
 * LLM on this surface.
 */
export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return fail(400, 'Request body must be valid JSON')
  }

  const parsed = requestBodySchema.safeParse(raw)
  if (!parsed.success) return fail(400, describeZodError(parsed.error))

  const current = getApplication(parsed.data.id)
  if (!current) return fail(404, 'unknown application')

  // Ahead of the requirements check, so a closed application answers 409
  // whatever the action carries rather than 422 "fix the value and retry".
  const closed = submittedRefusal(current)
  if (closed !== null) return fail(409, closed)

  const action = toAction(parsed.data.action)
  const refusal = checkAgainstRequirements(current, action)
  if (refusal) return fail(422, refusal)

  try {
    return NextResponse.json(applyAction(current, action))
  } catch (error) {
    if (error instanceof ApplicationSubmittedError) return fail(409, error.message)
    // The reducer signals a rejected request by throwing; that is a 422, not
    // a 500 with a stack trace.
    return fail(422, error instanceof Error ? error.message : 'Action rejected')
  }
}

/**
 * Carry runs on this path because it is the only write path. Auditing happens
 * before the store is updated, so an append that throws leaves the previous
 * state in place rather than a mutation with no trail entry.
 */
function applyAction(current: ApplicationState, action: Action): ApplicationState {
  const log = getAuditLog()
  const reduced = applicationReducer(current, action)
  const carried = applyCarry(reduced, action.at)

  log.append(current.id, action)
  for (const carriedAction of carried.applied) log.append(current.id, carriedAction)

  putApplication(carried.state)
  return carried.state
}

/**
 * A refusal message, or null if the action is allowed. Checked against
 * `requiredFields` rather than `outstandingFields` — an already-confirmed
 * field is still one the applicant may go back and correct.
 */
function checkAgainstRequirements(
  current: ApplicationState,
  action: Action,
): string | null {
  if (!('fieldId' in action)) return null

  let bareId
  try {
    bareId = parseReqKey(action.fieldId).fieldId
  } catch {
    return `Malformed field key: ${action.fieldId}`
  }

  if (!CATALOG.has(bareId)) return `Unknown field: ${action.fieldId}`

  if (!requiredFields(current.profile).includes(action.fieldId)) {
    return `Field "${action.fieldId}" is not part of this application`
  }

  if (action.type === 'SET_VALUE') {
    const result = fieldDef(bareId).validation.safeParse(action.value)
    if (!result.success) {
      return describeZodError(result.error)
    }
  }

  return null
}
