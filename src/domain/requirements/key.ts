import type { FieldId } from '../field-id'

/**
 * Identifies one required answer. For most fields this is just the FieldId.
 * Fields inside a repeatable group (licences) are qualified by instance:
 * `license_number#0`, `license_number#1`.
 */
export type RequirementKey = string

export function reqKey(id: FieldId, instance?: number): RequirementKey {
  if (instance === undefined) return id
  if (!Number.isInteger(instance) || instance < 0) {
    throw new Error(`Invalid instance ${instance}: must be a non-negative integer`)
  }
  return `${id}#${instance}`
}

export function parseReqKey(
  key: RequirementKey,
): { fieldId: FieldId; instance: number | null } {
  const hash = key.indexOf('#')
  if (hash === -1) return { fieldId: key as FieldId, instance: null }

  const idPart = key.slice(0, hash)
  const instancePart = key.slice(hash + 1)
  if (idPart === '' || !/^\d+$/.test(instancePart)) {
    throw new Error(`Malformed requirement key: ${key}`)
  }
  return { fieldId: idPart as FieldId, instance: Number(instancePart) }
}
