import { requiredFields } from '../requirements/engine'
import type { RequirementKey } from '../requirements/key'
import { applicationReducer } from './reducer'
import type { Action, ApplicationState } from './state'

/**
 * Values the applicant should never have to type twice. Spec §9.
 * The current design asks for an address up to three times; these rules
 * are the fix.
 */
export const CARRY_RULES: readonly { from: RequirementKey; to: RequirementKey }[] = [
  { from: 'addr_line1', to: 'biz_addr_line1' },
  { from: 'addr_line2', to: 'biz_addr_line2' },
  { from: 'addr_city', to: 'biz_addr_city' },
  { from: 'addr_state', to: 'biz_addr_state' },
  { from: 'addr_zip', to: 'biz_addr_zip' },
  { from: 'phone_primary', to: 'biz_phone' },
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
  const required = new Set(requiredFields(state.profile))
  let next = state
  const applied: Action[] = []

  for (const rule of CARRY_RULES) {
    if (!required.has(rule.to)) continue

    const source = next.fields[rule.from]
    if (!source || source.value === null || source.value === undefined) continue

    const dest = next.fields[rule.to]
    if (dest && dest.value !== null && dest.value !== undefined) continue

    const action: Action = {
      type: 'SET_VALUE',
      fieldId: rule.to,
      value: source.value,
      source: 'carried',
      fromFieldId: rule.from,
      at,
    }
    next = applicationReducer(next, action)
    applied.push(action)
  }

  return { state: next, applied }
}

export function carriedFrom(
  state: ApplicationState,
  id: RequirementKey,
): RequirementKey | null {
  const f = state.fields[id]
  if (!f?.provenance || f.provenance.source !== 'carried') return null
  return f.provenance.fromFieldId ?? null
}
