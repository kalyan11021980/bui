import { outstandingFields } from '../application/queries'
import type { ApplicationState } from '../application/state'
import { fieldDef } from '../catalog'
import { requiredFields } from '../requirements/engine'
import { parseReqKey, type RequirementKey } from '../requirements/key'
import type { Section } from '../section'
import type { Block, Turn } from './transcript'

/**
 * The Section union's declaration order. The model never chooses grouping;
 * this is the whole of how the conversation is sequenced.
 */
export const SECTION_ORDER = [
  'profile', 'identification', 'address', 'contact', 'business',
  'license', 'tax', 'gsa', 'state_forms',
] as const satisfies readonly Section[]

export type SectionPlan = { section: Section; fieldIds: readonly RequirementKey[] }

/**
 * The first section in order with outstanding fields, and every outstanding
 * field in it. Derived, never stored: answering moves it forward on its own,
 * and a cleared field moves it back.
 */
export function sectionPlan(state: ApplicationState): SectionPlan | null {
  const outstanding = outstandingFields(state)
  for (const section of SECTION_ORDER) {
    const fieldIds = outstanding.filter((id) => sectionOf(id) === section)
    if (fieldIds.length > 0) return { section, fieldIds }
  }
  return null
}

export function sectionProgress(
  state: ApplicationState,
  section: Section,
): { done: number; total: number } {
  const required = requiredFields(state.profile).filter((id) => sectionOf(id) === section)
  const outstanding = new Set(outstandingFields(state))
  return {
    done: required.filter((id) => !outstanding.has(id)).length,
    total: required.length,
  }
}

/** The newest section_header in the transcript — the group the applicant is looking at. */
export function lastPresentedSection(transcript: readonly Turn[]): Section | null {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const turn = transcript[i]!
    if (turn.role !== 'agent') continue
    for (let j = turn.blocks.length - 1; j >= 0; j -= 1) {
      const block = turn.blocks[j]!
      if (block.kind === 'section_header') return block.section
    }
  }
  return null
}

/** A question about a field, not a demand to fill the form. Closed heuristic
 *  — the model never chooses grouping, so neither does it choose this. */
export function isWhyShaped(text: string): boolean {
  const t = text.trim().toLowerCase()
  return t.startsWith('why ') || t.includes('why do you')
}

/**
 * The planned half of a turn. A Done always presents (same section's gaps
 * behind the vetted notice, or the next group); otherwise a section is
 * presented only when it is not already the newest one on screen — a typed
 * question mid-section gets its answer and stays put. A why-question gets
 * its answer alone; the group presents on the next non-why turn.
 */
export function planTurnBlocks(
  state: ApplicationState,
  transcript: readonly Turn[],
  doneWith: Section | null,
  applicantText: string | null,
): Block[] {
  const plan = sectionPlan(state)
  if (plan === null) return []

  if (doneWith !== null) {
    const group = groupBlocks(state, plan)
    return plan.section === doneWith
      ? [{ kind: 'notice', copyId: 'section_incomplete' }, ...group]
      : group
  }

  // A why-question gets its answer alone; the group presents on the next
  // non-why turn (or upload, or Done).
  if (applicantText !== null && isWhyShaped(applicantText)) return []

  if (lastPresentedSection(transcript) === plan.section) return []
  return groupBlocks(state, plan)
}

function groupBlocks(state: ApplicationState, plan: SectionPlan): Block[] {
  const { done, total } = sectionProgress(state, plan.section)
  return [
    { kind: 'section_header', section: plan.section, done, total },
    ...plan.fieldIds.map((fieldId) => ({ kind: 'field_ask' as const, fieldId })),
  ]
}

function sectionOf(key: RequirementKey): Section {
  return fieldDef(parseReqKey(key).fieldId).section
}
