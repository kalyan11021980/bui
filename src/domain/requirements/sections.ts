import { fieldDef } from '../catalog'
import { SECTION_LABEL } from '../section'
import { parseReqKey, type RequirementKey } from './key'

export type SectionGroup = {
  /** Section name, qualified by instance for a repeated group: `license#0`. */
  id: string
  /** The heading the applicant reads — "Address", "License 2". */
  label: string
  fields: RequirementKey[]
}

/**
 * Chunks requirement keys into the sections the panel renders, in
 * first-appearance order — a declared ordering would be a second source of
 * truth that could disagree with the engine.
 */
export function groupIntoSections(
  keys: readonly RequirementKey[],
): SectionGroup[] {
  const groups = new Map<string, SectionGroup>()

  for (const key of keys) {
    const { fieldId, instance } = parseReqKey(key)
    const section = fieldDef(fieldId).section
    const id = instance === null ? section : `${section}#${instance}`

    const existing = groups.get(id)
    if (existing) {
      existing.fields.push(key)
      continue
    }

    // 0-based internally, 1-based on screen, as FieldRow numbers its rows.
    const label = instance === null
      ? SECTION_LABEL[section]
      : `${SECTION_LABEL[section]} ${instance + 1}`
    groups.set(id, { id, label, fields: [key] })
  }

  return [...groups.values()]
}
