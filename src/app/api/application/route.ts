import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
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
 * The id is generated HERE, not taken from the query string. Previously any
 * id the caller supplied would be created on demand, so `?id=1` and `?id=2`
 * both worked and the response carries `tax_id.value` — the one place on this
 * branch where a raw taxpayer ID crosses a wire. A UUID is not authorisation,
 * but it stops the ids being enumerable, and this is the response shape
 * phases 2-4 extend.
 *
 * TODO(phase-2): ownership check. Nothing here establishes WHO is asking.
 * Knowing an application id is currently sufficient to read every value in
 * it, including the taxpayer ID and date of birth. What is missing is an
 * authenticated session, an owner recorded on the application at creation,
 * and a comparison of the two before this handler returns anything —
 * plus a decision about whether values should be masked in the response at
 * all, per §8.1. Phase 1 is demo-scoped and in-memory; this must not ship to
 * real applicants as it stands.
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
 * Spec §8.2: invariants live in code, not in prompts. This handler is THE
 * enforcement point — it rejects any action naming a field outside the
 * requirements engine's current set, and any value the field's own schema
 * refuses. Phase 3 puts an LLM on this exact surface, so a check that is only
 * in the panel is not a check at all.
 *
 * Returns 400 for "this is not a well-formed request" and 422 for "this is
 * well-formed and not allowed", so a caller can tell a bug from a rejection.
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

  const action = toAction(parsed.data.action)
  const refusal = checkAgainstRequirements(current, action)
  if (refusal) return fail(422, refusal)

  try {
    return NextResponse.json(applyAction(current, action))
  } catch (error) {
    // The reducer enforces its own invariants by throwing (confirming a field
    // with no value, carrying with no origin). Those are rejected requests,
    // not server faults: a 500 with a stack trace is both the wrong signal to
    // the caller and, on a KYC surface, the wrong thing to emit.
    return fail(422, error instanceof Error ? error.message : 'Action rejected')
  }
}

/**
 * Applies the action, carries what follows from it, and records every one of
 * those in the trail before anything is persisted.
 *
 * Carry runs here rather than being left to a caller because this is the only
 * write path: with it anywhere else, §9's headline case — an applicant typing
 * the same address three times — stays unsolved in the running app, which is
 * exactly where it was.
 *
 * Ordering is deliberate. Every carried SET_VALUE is audited alongside the
 * action that triggered it, because a carried value is still a value that
 * landed in the applicant's record. And an action we cannot audit is an
 * action we must not apply: if any append throws, the store is left holding
 * the previous state rather than a mutation with no corresponding trail.
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
 * Returns a refusal message, or null if the action is allowed.
 *
 * The check is against `requiredFields`, NOT `outstandingFields`: a field the
 * applicant has already confirmed is still a field they are entitled to go
 * back and correct. Outstanding-only would make every answer final on first
 * submission, which is a worse failure than the one being fixed.
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
