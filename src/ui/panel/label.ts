import { fieldDef } from '@/domain/catalog'
import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'

/**
 * The name one row goes by, on screen and to a screen reader.
 *
 * A repeated group (licences) renders one row per instance; without a number,
 * two "License number" rows are indistinguishable in both. Instances are
 * 0-based internally and 1-based on screen, which is also how
 * `groupIntoSections` numbers the sections that contain them.
 *
 * Shared rather than inlined in FieldRow because the carry acknowledgement
 * names a DIFFERENT row than the one it is rendered in, and a second copy of
 * this rule would eventually disagree with the first about what that row is
 * called.
 */
export function displayLabel(fieldId: RequirementKey): string {
  const { fieldId: bareId, instance } = parseReqKey(fieldId)
  const def = fieldDef(bareId)
  return instance === null ? def.label : `${def.label} ${instance + 1}`
}
