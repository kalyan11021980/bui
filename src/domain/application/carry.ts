import { requiredFields } from '../requirements/engine'
import type { RequirementKey } from '../requirements/key'
import { applicationReducer } from './reducer'
import type { Action, ApplicationState, FieldState } from './state'

/**
 * Values the applicant should never have to type twice.
 *
 * Both ends of every rule must be keys the requirements engine emits for some
 * profile — a rule whose source is never collected can never fire, and reads
 * like working redundancy-removal while doing nothing. carry.test.ts asserts
 * this.
 */
export const CARRY_RULES: readonly { from: RequirementKey; to: RequirementKey }[] = [
  { from: 'addr_line1', to: 'biz_addr_line1' },
  { from: 'addr_city', to: 'biz_addr_city' },
  { from: 'addr_state', to: 'biz_addr_state' },
  { from: 'addr_zip', to: 'biz_addr_zip' },
  { from: 'phone_mobile', to: 'biz_phone' },
]

export type CarryResult = {
  state: ApplicationState
  /** What carry dispatched, in order. The caller must audit these. */
  applied: readonly Action[]
}

/**
 * Copies each source value into its destination when the destination is still
 * empty. Carried values land as `derived`, so the user still confirms them.
 *
 * Only destinations the requirements engine emits for this profile are
 * filled, or an individual applicant would accumulate `biz_addr_*` fields
 * that the panel never shows and the route never validates.
 */
export function applyCarry(state: ApplicationState, at: string): CarryResult {
  // Carry is a mutation, and a submitted application is closed to those.
  if (state.submittedAt !== null) return { state, applied: [] }

  const required = new Set(requiredFields(state.profile))
  let next = state
  const applied: Action[] = []

  for (const rule of CARRY_RULES) {
    if (!required.has(rule.to)) continue

    const dest = next.fields[rule.to]
    if (!isCarryable(dest, rule.from)) continue

    const source = next.fields[rule.from]
    const sourceValue = source?.value ?? null

    if (sourceValue === null || sourceValue === undefined) {
      // The source answer is gone, and `isCarryable` has established this
      // destination is nothing but an unconfirmed mirror of it. Leaving it
      // behind is a plausible stale value, which is what gets rubber-stamped.
      if (dest && dest.value !== null && dest.value !== undefined) {
        const clear: Action = { type: 'CLEAR_VALUE', fieldId: rule.to, at }
        next = applicationReducer(next, clear)
        applied.push(clear)
      }
      continue
    }

    if (dest && dest.value === sourceValue) continue

    const action: Action = {
      type: 'SET_VALUE',
      fieldId: rule.to,
      value: sourceValue,
      source: 'carried',
      fromFieldId: rule.from,
      at,
    }
    next = applicationReducer(next, action)
    applied.push(action)
  }

  return { state: next, applied }
}

/**
 * Empty, or still nothing but an unconfirmed mirror of this same source.
 *
 * The second clause matters: "empty only" never refreshes, so typing an
 * address a character at a time leaves the business address reading "2". Once
 * the value stops being a mirror — confirmed, rejected, hand-edited, OCR'd,
 * or carried from a different source — it is the applicant's and off limits.
 */
function isCarryable(dest: FieldState | undefined, from: RequirementKey): boolean {
  if (!dest || dest.value === null || dest.value === undefined) return true
  return (
    dest.status === 'derived' &&
    dest.provenance?.source === 'carried' &&
    dest.provenance.fromFieldId === from
  )
}

/**
 * What to tell the applicant about what their last edit changed elsewhere.
 * Carry's value is entirely in their noticing it, and the destinations are
 * usually in another section, below the fold.
 */
export type CarryNotice = {
  /** The field the applicant edited. The acknowledgement is anchored to it. */
  from: RequirementKey
  filled: readonly RequirementKey[]
  cleared: readonly RequirementKey[]
}

/** Null when the edit changed nothing elsewhere — there is then nothing to say. */
export function carryNotice(
  from: RequirementKey,
  applied: readonly Action[],
): CarryNotice | null {
  const filled = applied.flatMap((a) =>
    a.type === 'SET_VALUE' ? [a.fieldId] : [],
  )
  const cleared = applied.flatMap((a) =>
    a.type === 'CLEAR_VALUE' ? [a.fieldId] : [],
  )
  if (filled.length === 0 && cleared.length === 0) return null
  return { from, filled, cleared }
}

export function carriedFrom(
  state: ApplicationState,
  id: RequirementKey,
): RequirementKey | null {
  const f = state.fields[id]
  if (!f?.provenance || f.provenance.source !== 'carried') return null
  return f.provenance.fromFieldId ?? null
}
