import { requiredFields } from '../requirements/engine'
import type { RequirementKey } from '../requirements/key'
import { applicationReducer } from './reducer'
import type { Action, ApplicationState, FieldState } from './state'

/**
 * Values the applicant should never have to type twice. Spec §9.
 * The current design asks for an address up to three times; these rules
 * are the fix.
 *
 * Every `from` must be a key the requirements engine actually emits for some
 * profile, and so must every `to` — a rule whose source is never asked for
 * can never fire, and reads like working redundancy-removal while doing
 * nothing. Two rules were in exactly that state:
 *
 * - `addr_line2 -> biz_addr_line2`: neither side is ever required (both are
 *   optional apartment/suite lines), so the rule was unreachable from both
 *   ends. Dropped deliberately rather than making line 2 mandatory, which
 *   would be a worse answer to a smaller problem.
 * - `phone_primary -> biz_phone`: CORE_CONTACT is `['phone_mobile']` only,
 *   so the source was never collected — while `biz_phone` IS required of
 *   every business. The phone redundancy the spec names was untouched.
 *   Re-pointed at `phone_mobile`, which is the carry that actually helps.
 *
 * `tests/domain/application/carry.test.ts` asserts this property, so the
 * drift cannot come back silently.
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
  /**
   * The SET_VALUE actions carry actually dispatched, in order.
   *
   * Returned rather than swallowed because the caller has to audit them. A
   * carried value is a value that landed in the applicant's record, and a
   * record change with no trail entry is exactly the gap §10.1 exists to
   * close.
   */
  applied: readonly Action[]
}

/**
 * Copies each source value into its destination when the destination is
 * still empty. Carried values land as `derived`, so the user still gets to
 * confirm them — carrying saves typing, not attention.
 *
 * Only destinations the requirements engine currently emits for this profile
 * are filled. Without that, an individual applicant — who is never asked for
 * a business address — would still accumulate `biz_addr_*` fields in their
 * record: invisible in the panel, outside the route's own §8.2 enforcement,
 * and persisted and logged all the same.
 */
export function applyCarry(state: ApplicationState, at: string): CarryResult {
  // A submitted application is closed to every mutation, and carry is a
  // mutation. Today nothing would be carried anyway — submission requires
  // every destination to be confirmed, and confirmed values are not carryable
  // — but relying on that leaves the reducer throwing the day it stops being
  // true, on a path the caller cannot see.
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
      // The source answer is gone. Anything still holding a mirror of it is
      // now a plausible value with nothing behind it, which is precisely what
      // §10.4 says gets rubber-stamped — and it is a value the applicant
      // deleted. `isCarryable` above has already established that this
      // destination is nothing but an unconfirmed mirror of THIS source.
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
 * May carry write here?
 *
 * Yes when the destination is empty, and yes when it still holds nothing but
 * an unconfirmed mirror of this same source. No in every other case.
 *
 * The second clause is the one that matters. "Empty destinations only" looks
 * right until the source changes: typing an address one character at a time
 * carries the first keystroke and then never refreshes, so the applicant ends
 * up with a business address reading "2". Over the API it is worse but
 * quieter — correcting a home address leaves a STALE carried business address
 * behind, and a plausible stale value is exactly what gets rubber-stamped
 * (§10.4).
 *
 * The moment the value stops being a mirror it becomes the applicant's:
 * confirmed, verified, rejected, edited by hand, or filled by OCR, and carry
 * must never touch it again. A carried value that came from a DIFFERENT
 * source field is equally off limits.
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
 * What to tell the applicant, right where they are looking, about what their
 * last edit filled in elsewhere.
 *
 * Carry is one of the four mechanisms §5 credits with the whole effort
 * reduction, and its value is entirely in the applicant NOTICING they were
 * saved work. Before this, typing a home address filled the business address
 * in correctly — in another section, below the fold, where nobody saw it. A
 * saving nobody sees is worth approximately nothing.
 *
 * Derived here rather than in the panel because `applied` is the domain's own
 * record of what happened, and phase 3's orchestrator will need the same
 * summary to say the same thing out loud.
 */
export type CarryNotice = {
  /** The field the applicant edited. The acknowledgement is anchored to it. */
  from: RequirementKey
  /** What carry filled in as a result, in the order it was applied. */
  filled: readonly RequirementKey[]
  /**
   * What carry removed because this edit took away the answer it was copied
   * from. Told, not done quietly: a field silently emptying somewhere the
   * applicant cannot see is the same invisibility problem as a field silently
   * filling in, and this one loses them work rather than saving it.
   */
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
