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
  return lastPresentedSectionTurn(transcript)?.section ?? null
}

/**
 * The turn that last presented a section, and which section. The Done control
 * is part of that group, so the UI needs the turn's seq to place the control
 * inside the right turn bubble — not just the section name.
 */
export function lastPresentedSectionTurn(
  transcript: readonly Turn[],
): { section: Section; seq: number } | null {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const turn = transcript[i]!
    if (turn.role !== 'agent') continue
    for (let j = turn.blocks.length - 1; j >= 0; j -= 1) {
      const block = turn.blocks[j]!
      if (block.kind === 'section_header') return { section: block.section, seq: turn.seq }
    }
  }
  return null
}

/** A question, not a demand to fill the form. Closed heuristic — the model
 *  never chooses grouping, so neither does it choose this. Catches a typed
 *  question mark, a WH-word opener (what / how / why / which / who / when /
 *  where), and the "why do you" phrasing the question pills use. Auxiliary
 *  openers (do / is / will …) are deliberately left out: "Will do" and "Is
 *  fine" are acks, and a question phrased that way ends with "?" anyway. */
export function isFreeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.endsWith('?')) return true
  if (t.includes('why do you')) return true
  return /^(?:what|which|who|whom|whose|when|where|why|how)\b/.test(t)
}

/** A greeting or casual opener, not engagement with the form. Closed list so
 *  it stays auditable. A greeting suppresses the section just like a question:
 *  the agent greets back and the form presents on the next turn. */
const GREETING = /^(?:hi|hello|hey|hiya|howdy|yo|sup|greetings|good\s+(?:morning|afternoon|evening)|what'?s\s+up)\b/i

export function isGreeting(text: string): boolean {
  return GREETING.test(text.trim())
}

/**
 * The planned half of a turn. A Done always presents (same section's gaps
 * behind the vetted notice, or the next group); otherwise a section is
 * presented only when it is not already the newest one on screen — a typed
 * question mid-section gets its answer and stays put. A free-form question
 * gets its answer alone; the group presents on the next non-question turn.
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

  // A free-form question or greeting gets its answer alone; the group
  // presents on the next non-conversational turn (or upload, or Done).
  if (applicantText !== null && (isFreeQuestion(applicantText) || isGreeting(applicantText))) {
    return []
  }

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
