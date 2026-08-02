import { describeZodError } from '@/domain/application/action-schema'
import { CATALOG, fieldDef } from '@/domain/catalog'
import { requiredFields } from '@/domain/requirements/engine'
import { parseReqKey } from '@/domain/requirements/key'
import type { Action, ApplicationState } from '@/domain/application/state'

/**
 * A refusal message, or null if the action is allowed. Checked against
 * `requiredFields` rather than `outstandingFields` — an already-confirmed
 * field is still one the applicant may go back and correct.
 *
 * Phase 3 puts an LLM on this surface, so a check that lives only in the
 * panel is not a check.
 */
export function checkAgainstRequirements(
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
