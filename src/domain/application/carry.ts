import type { RequirementKey } from '../requirements/key'
import { applicationReducer } from './reducer'
import type { ApplicationState } from './state'

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

/**
 * Copies each source value into its destination when the destination is
 * still empty. Carried values land as `derived`, so the user still gets to
 * confirm them — carrying saves typing, not attention.
 */
export function applyCarry(
  state: ApplicationState,
  at: string,
): ApplicationState {
  let next = state
  for (const rule of CARRY_RULES) {
    const source = next.fields[rule.from]
    if (!source || source.value === null || source.value === undefined) continue

    const dest = next.fields[rule.to]
    if (dest && dest.value !== null && dest.value !== undefined) continue

    next = applicationReducer(next, {
      type: 'SET_VALUE',
      fieldId: rule.to,
      value: source.value,
      source: 'carried',
      fromFieldId: rule.from,
      at,
    })
  }
  return next
}

export function carriedFrom(
  state: ApplicationState,
  id: RequirementKey,
): RequirementKey | null {
  const f = state.fields[id]
  if (!f?.provenance || f.provenance.source !== 'carried') return null
  return f.provenance.fromFieldId ?? null
}
