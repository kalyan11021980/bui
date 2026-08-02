import { fieldDef } from '@/domain/catalog'
import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'

/**
 * The name one row goes by, on screen and to a screen reader. Instances are
 * 0-based internally and 1-based on screen, matching `groupIntoSections`.
 */
export function displayLabel(fieldId: RequirementKey): string {
  const { fieldId: bareId, instance } = parseReqKey(fieldId)
  const def = fieldDef(bareId)
  return instance === null ? def.label : `${def.label} ${instance + 1}`
}
