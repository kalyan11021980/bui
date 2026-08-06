import { randomUUID } from 'node:crypto'
import type { LanguageModel } from 'ai'
import { applyCarry } from '@/domain/application/carry'
import {
  ApplicationSubmittedError, submittedRefusal,
} from '@/domain/application/guards'
import {
  applicationReducer, createApplication as newApplication,
} from '@/domain/application/reducer'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { planTurnBlocks } from '@/domain/orchestrator/plan'
import { PANEL_ONLY_THRESHOLD, toOrchestratorView } from '@/domain/orchestrator/view'
import type { Turn } from '@/domain/orchestrator/transcript'
import type { Section } from '@/domain/section'
import { runTurn, type TurnRequest, type TurnResult } from '@/server/orchestrator/service'
import { getAuditLog } from '@/server/audit'
import {
  newOwnerToken, ownsApplication, withoutOwnerToken,
} from '@/server/ownership'
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
  addressDiffersFromId: false,
  idForm: 'drivers_license',
}

/**
 * The id is generated here rather than accepted from the caller, so ids are
 * not enumerable — the response carries `tax_id.value`.
 *
 * The only result that carries the owner token. Every other one is redacted on
 * the way out, so no route has to remember to do it.
 */
export function createApplication(): ApplicationState {
  const created = newApplication(randomUUID(), STARTING_PROFILE, newOwnerToken())
  putApplication(created)
  return created
}

export function getApplication(
  id: string,
  ownerToken: string | null,
): Result<ApplicationState> {
  const existing = owned(id, ownerToken)
  if (!existing.ok) return existing
  return { ok: true, value: withoutOwnerToken(existing.value) }
}

export function applyAction(
  id: string,
  ownerToken: string | null,
  action: Action,
): Result<ApplicationState> {
  const found = owned(id, ownerToken)
  if (!found.ok) return found
  const current = found.value

  // Ahead of the requirements check, so a closed application answers 409
  // whatever the action carries rather than 422 "fix the value and retry".
  const closed = submittedRefusal(current)
  if (closed !== null) return { ok: false, failure: failure('submitted', closed) }

  const refusal = checkAgainstRequirements(current, action)
  if (refusal) return { ok: false, failure: failure('rejected', refusal) }

  try {
    return { ok: true, value: withoutOwnerToken(commit(current, action)) }
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

export type TurnInput = {
  /** Applicant's own words this turn, if any. */
  text: string | undefined
  /** The section a Done chip closed out, if this turn is one. */
  doneWith: Section | undefined
  /**
   * Resolves the model plus the config that travels with it, lazily — so a
   * misconfigured provider throws inside the same try/catch as an unreachable
   * one, and both land on the same degraded turn instead of a 500.
   */
  modelForTurn: () => { model: LanguageModel; effort: string; isAnthropic: boolean }
  isResume: boolean
  uploadedDocs: readonly DocType[]
  at: string
}

/**
 * Runs one guarded model turn and persists its effects: the applicant's own
 * message (if any), whatever tool calls survived the guard, the agent's
 * turn, and one RECORD_REJECTION per refusal. Never lets a model failure
 * reach the caller as a 500 — it degrades to a turn saying so instead.
 */
export async function applyTurn(
  id: string,
  ownerToken: string | null,
  input: TurnInput,
): Promise<Result<{ state: ApplicationState; turn: Turn }>> {
  const found = owned(id, ownerToken)
  if (!found.ok) return found
  let current = found.value

  const closed = submittedRefusal(current)
  if (closed !== null) return { ok: false, failure: failure('submitted', closed) }

  // Keyed off truthiness throughout, after trimming: whitespace-only text is
  // "no text", the same as it not being sent, both for whether an applicant
  // turn is appended and for what the model is told the applicant said.
  const trimmed = input.text?.trim()
  const text = trimmed ? trimmed : null
  const doneWith = input.doneWith ?? null
  // The route enforces exactly-one; a second caller must not slip past it.
  if (text && doneWith) {
    return { ok: false, failure: failure('malformed', 'exactly one of text or doneWith') }
  }
  const applicantText = text ?? (doneWith ? vettedCopy('done_chip') : null)

  try {
    if (applicantText) {
      current = commit(current, {
        type: 'APPEND_TURN',
        at: input.at,
        turn: {
          seq: current.transcript.length + 1,
          at: input.at,
          role: 'applicant',
          voice: null,
          blocks: [],
          text: applicantText,
        },
      })
    }

    // The model call below is a real, possibly multi-second network round
    // trip. Nothing holds a lock across it, so what commits next must not
    // reduce from this pre-await snapshot — a concurrent SET_VALUE, upload,
    // or SUBMIT landing meanwhile would otherwise be silently overwritten
    // when this turn's writes land on top of it.
    const result = await runTurnSafely(input.modelForTurn, {
      view: toOrchestratorView(current, input.uploadedDocs),
      state: current,
      transcript: current.transcript,
      uploadedDocs: input.uploadedDocs,
      userText: applicantText,
      isResume: input.isResume,
      at: input.at,
      doneWith,
    })

    // Re-read from the store rather than reuse `current`: this is the state
    // as it actually is now, after whatever landed during the await above.
    const fresh = owned(id, ownerToken)
    if (!fresh.ok) return fresh
    current = fresh.value

    // The same refusal the pre-await check made, re-run against the current
    // record — a SUBMIT that landed during the model call answers exactly
    // the 409 it would have if it had landed a moment earlier.
    const closedNow = submittedRefusal(current)
    if (closedNow !== null) return { ok: false, failure: failure('submitted', closedNow) }

    for (const action of result.actions) current = commit(current, action)

    // Rejections already on the record (from earlier turns) plus this one:
    // the agent stops offering tools once either crosses the threshold, so a
    // turn that lands after it was already reached must render the same way
    // as the turn that reached it.
    const misbehaviour = result.rejections
    const alreadyPanelOnly = current.orchestratorRejections >= PANEL_ONLY_THRESHOLD
    const projected = current.orchestratorRejections + misbehaviour.length
    const panelOnly = alreadyPanelOnly || projected >= PANEL_ONLY_THRESHOLD

    const turn: Turn = {
      ...result.turn,
      seq: current.transcript.length + 1,
      ...(panelOnly && {
        // Replaces, not appends: "I'll step back" alongside an ask in the
        // same breath would contradict the notice it sits next to. And it is
        // said once, not on every turn after — a run of silent turns keeps
        // committing for the audit trail, but only an applicant speaking
        // earns the notice again.
        blocks: stepBackNoticeStanding(current.transcript)
          ? []
          : [{ kind: 'notice', copyId: 'panel_only_notice' as const }],
      }),
      ...(result.rejections.length > 0 && { rejections: [...result.rejections] }),
    }

    current = commit(current, { type: 'APPEND_TURN', at: input.at, turn })
    for (let i = 0; i < misbehaviour.length; i += 1) {
      current = commit(current, { type: 'RECORD_REJECTION', at: input.at })
    }

    return { ok: true, value: { state: withoutOwnerToken(current), turn } }
  } catch (error) {
    if (error instanceof ApplicationSubmittedError) {
      return { ok: false, failure: failure('submitted', error.message) }
    }
    // Mirrors applyAction: a throw partway through (a rogue stored field, a
    // reducer refusal) is a 422 with a message, not a 500 with a stack trace
    // — and it must not leave a half-written turn with no trail entry, which
    // commit()'s audit-before-write ordering already guarantees.
    return {
      ok: false,
      failure: failure('rejected', error instanceof Error ? error.message : 'Turn rejected'),
    }
  }
}

/**
 * Runs the turn, catching both a failure to resolve the model and a failure
 * of the model call itself — the applicant sees the same graceful notice
 * either way, and nothing it returns is mistaken for a guard rejection.
 */
async function runTurnSafely(
  modelForTurn: () => { model: LanguageModel; effort: string; isAnthropic: boolean },
  rest: Omit<TurnRequest, 'model' | 'effort' | 'isAnthropic'>,
): Promise<TurnResult> {
  try {
    const { model, effort, isAnthropic } = modelForTurn()
    return await runTurn({ ...rest, model, effort, isAnthropic })
  } catch (error) {
    // Server-side only: the applicant still gets the vetted degraded_notice
    // below, never this. Without this line a bad model call is
    // indistinguishable from a bad `guardToolCall`/`decideVoice` — both
    // degrade identically and the operator is left curling the model
    // endpoint to find out which.
    console.error('[runTurnSafely] model turn failed:', error)
    const seq = rest.transcript.reduce((max, t) => Math.max(max, t.seq), 0) + 1
    return {
      turn: {
        seq,
        at: rest.at,
        role: 'agent',
        voice: null,
        blocks: [
          { kind: 'notice', copyId: 'degraded_notice' },
          ...planTurnBlocks(rest.state, rest.transcript, rest.doneWith),
        ],
      },
      actions: [],
      rejections: [],
    }
  }
}

/**
 * The stored record, if the caller holds its token. A wrong token answers
 * exactly what an unknown id answers: 403 here would confirm the id exists,
 * which is the same leak wearing a smaller hat.
 */
/**
 * Whether "I'll step back" is already the agent's standing last word: walks
 * back over agent turns (silent ones included) and stops at the first
 * applicant turn — a person speaking always earns the notice again.
 */
function stepBackNoticeStanding(transcript: readonly Turn[]): boolean {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const turn = transcript[i]!
    if (turn.role === 'applicant') return false
    if (turn.blocks.some((b) => b.kind === 'notice' && b.copyId === 'panel_only_notice')) {
      return true
    }
  }
  return false
}

function owned(id: string, ownerToken: string | null): Result<ApplicationState> {
  const existing = loadApplication(id)
  if (!existing || !ownsApplication(existing, ownerToken)) {
    return { ok: false, failure: failure('unknown', 'unknown application') }
  }
  return { ok: true, value: existing }
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
