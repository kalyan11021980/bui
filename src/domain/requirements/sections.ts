import { fieldDef } from '../catalog'
import { SECTION_LABEL } from '../section'
import { parseReqKey, type RequirementKey } from './key'

export type SectionGroup = {
  /**
   * Stable within one profile: the section name, qualified by instance for a
   * repeated group (`license#0`). Used as a React key and as the id a heading
   * is announced by, so it must not collide across licences.
   */
  id: string
  /** The heading the applicant reads — "Address", "License 2". */
  label: string
  /** The keys in this section, in the order the engine emitted them. */
  fields: RequirementKey[]
}

/**
 * Chunks a list of requirement keys into the sections the panel renders.
 *
 * Order is first-appearance order, which is to say the order the requirements
 * engine emits: identification, address, contact, then business, tax,
 * licences, GSA and any state-specific forms. A separate declared ordering
 * would be a second source of truth that could disagree with the engine, and
 * the engine's order is the one the applicant is asked to work through.
 *
 * Licences are numbered per instance, so a business holding two of them reads
 * as "License 1" and "License 2" rather than ten loose rows in which
 * "License number" appears twice.
 *
 * Pure: keys in, groups out. No state, no clock.
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

    // Instances are 0-based internally and 1-based on screen, matching how
    // FieldRow numbers the rows inside them.
    const label = instance === null
      ? SECTION_LABEL[section]
      : `${SECTION_LABEL[section]} ${instance + 1}`
    groups.set(id, { id, label, fields: [key] })
  }

  return [...groups.values()]
}
