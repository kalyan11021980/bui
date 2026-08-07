import { describe, it, expect } from 'vitest'
import {
  SECTION_ORDER, sectionPlan, sectionProgress, lastPresentedSection, planTurnBlocks, isWhyShaped,
} from '@/domain/orchestrator/plan'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import type { RequirementKey } from '@/domain/requirements/key'
import type { Section } from '@/domain/section'
import { SECTION_LABEL } from '@/domain/section'
import type { Turn } from '@/domain/orchestrator/transcript'

const AT = '2026-08-06T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
  bizCountry: null,
}

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }

/**
 * A bridged field now feeds SET_VALUE back into the profile, so a blanket
 * 'x' can corrupt it (e.g. id_form: 'x' has no ID_NUMBER entry). Bridged
 * fields get a value that keeps the profile as it already is.
 */
function valueFor(id: RequirementKey): unknown {
  switch (id) {
    case 'applicant_type': return PROFILE.applicantType
    case 'location_country': return PROFILE.country
    case 'location_state': return PROFILE.state
    case 'id_form': return PROFILE.idForm
    case 'address_differs': return PROFILE.addressDiffersFromId ? 'yes' : 'no'
    case 'wants_gsa': return PROFILE.wantsGsa ? 'yes' : 'no'
    default: return 'x'
  }
}

/** Answers every outstanding field except `keep`, looping until stable. */
function answeredExcept(keep: readonly RequirementKey[]): ApplicationState {
  let state = fresh()
  for (;;) {
    const next = outstandingFields(state).find((id) => !keep.includes(id))
    if (!next) return state
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: next, value: valueFor(next), source: 'user', at: AT,
    })
  }
}

function answer(state: ApplicationState, fieldId: RequirementKey): ApplicationState {
  return applicationReducer(state, {
    type: 'SET_VALUE', fieldId, value: valueFor(fieldId), source: 'user', at: AT,
  })
}

const header = (section: Section, done = 0, total = 1): Turn => ({
  seq: 1, at: AT, role: 'agent', voice: null,
  blocks: [{ kind: 'section_header', section, done, total }],
})

describe('SECTION_ORDER', () => {
  it('covers every section exactly once, in declaration order', () => {
    expect([...SECTION_ORDER]).toEqual(Object.keys(SECTION_LABEL))
  })
})

describe('sectionPlan', () => {
  it('picks the earliest section with outstanding fields, and all of them', () => {
    const state = answeredExcept(['addr_city', 'phone_mobile'])   // address before contact
    const plan = sectionPlan(state)
    expect(plan).toEqual({ section: 'address', fieldIds: ['addr_city'] })
  })

  it('moves back when a field is cleared', () => {
    const state = answer(answeredExcept(['phone_mobile']), 'phone_mobile')
    const reopened = applicationReducer(state, { type: 'CLEAR_VALUE', fieldId: 'addr_city', at: AT })
    expect(sectionPlan(reopened)?.section).toBe('address')
  })

  it('is null when nothing is outstanding', () => {
    expect(sectionPlan(answeredExcept([]))).toBeNull()
  })
})

describe('sectionProgress', () => {
  it('counts answered against all required fields of the section', () => {
    const state = answeredExcept(['addr_city', 'addr_zip'])
    const before = sectionProgress(state, 'address')
    expect(before.total - before.done).toBe(2)
    const after = sectionProgress(answer(state, 'addr_city'), 'address')
    expect(after).toEqual({ done: before.done + 1, total: before.total })
  })
})

describe('lastPresentedSection', () => {
  it('is null on an empty transcript', () => {
    expect(lastPresentedSection([])).toBeNull()
  })

  it('reads the newest header, skipping applicant turns', () => {
    const applicant: Turn = { seq: 2, at: AT, role: 'applicant', voice: null, blocks: [], text: 'hi' }
    expect(lastPresentedSection([header('address'), applicant])).toBe('address')
  })
})

describe('planTurnBlocks', () => {
  it('presents the planned group when nothing has been presented yet', () => {
    const state = answeredExcept(['addr_city'])
    const blocks = planTurnBlocks(state, [], null, null)
    expect(blocks[0]).toMatchObject({ kind: 'section_header', section: 'address' })
    expect(blocks.slice(1)).toEqual([{ kind: 'field_ask', fieldId: 'addr_city' }])
  })

  it('presents nothing when the current section is already the newest header', () => {
    const state = answeredExcept(['addr_city'])
    expect(planTurnBlocks(state, [header('address')], null, null)).toEqual([])
  })

  it('re-presents after the plan moves back to an earlier section', () => {
    const state = answeredExcept(['addr_city', 'phone_mobile'])
    const blocks = planTurnBlocks(state, [header('contact')], null, null)
    expect(blocks[0]).toMatchObject({ kind: 'section_header', section: 'address' })
  })

  it('a gapped Done re-presents only the missing fields, behind the vetted notice', () => {
    const state = answeredExcept(['addr_city', 'addr_zip'])
    const blocks = planTurnBlocks(state, [header('address')], 'address', null)
    expect(blocks[0]).toEqual({ kind: 'notice', copyId: 'section_incomplete' })
    expect(blocks[1]).toMatchObject({ kind: 'section_header', section: 'address' })
    expect(blocks.slice(2)).toEqual([
      { kind: 'field_ask', fieldId: 'addr_city' },
      { kind: 'field_ask', fieldId: 'addr_zip' },
    ])
  })

  it('a complete Done advances to the next section, without the notice', () => {
    const state = answeredExcept(['phone_mobile'])          // address done, contact open
    const blocks = planTurnBlocks(state, [header('address')], 'address', null)
    expect(blocks[0]).toMatchObject({ kind: 'section_header', section: 'contact' })
    expect(blocks.some((b) => b.kind === 'notice')).toBe(false)
  })

  it('the final Done yields no blocks at all', () => {
    expect(planTurnBlocks(answeredExcept([]), [header('contact')], 'contact', null)).toEqual([])
  })
})

describe('isWhyShaped', () => {
  it('accepts the pill templates and typed variants', () => {
    expect(isWhyShaped('Why do you need my last name?')).toBe(true)
    expect(isWhyShaped('Why do you ask "Which ID will you use?"')).toBe(true)
    expect(isWhyShaped('  WHY is that required')).toBe(true)
    expect(isWhyShaped('tell me why do you need this')).toBe(true)
    expect(isWhyShaped('Why?')).toBe(true)
    expect(isWhyShaped("Why's that needed?")).toBe(true)
  })

  it('rejects non-why intents', () => {
    expect(isWhyShaped('What else do you need?')).toBe(false)
    expect(isWhyShaped("I'm ready")).toBe(false)
    expect(isWhyShaped('Tell me why later')).toBe(false)
    // No word boundary between "why" and "ever" — not a why-question.
    expect(isWhyShaped('Whyever would I mind')).toBe(false)
  })
})

describe('planTurnBlocks and why-shaped turns', () => {
  it('presents nothing for a why-question on an empty transcript', () => {
    const state = fresh()
    expect(planTurnBlocks(state, [], null, 'Why do you ask "What best describes you?"'))
      .toEqual([])
  })

  it('still presents for a non-why first turn', () => {
    const state = fresh()
    const blocks = planTurnBlocks(state, [], null, 'What else do you need?')
    expect(blocks[0]).toMatchObject({ kind: 'section_header' })
  })

  it('presents nothing for a why-question even when the plan has advanced', () => {
    // The newest header on screen is an older section; a non-why turn would
    // present the current plan section — a why turn must not.
    const state = fresh()
    const plan = sectionPlan(state)!
    const stale: Turn = {
      seq: 1, at: AT, role: 'agent', voice: null,
      blocks: [{ kind: 'section_header', section: 'tax', done: 0, total: 1 }],
    }
    expect(plan.section).not.toBe('tax')
    expect(planTurnBlocks(state, [stale], null, 'why do you need all this')).toEqual([])
    expect(planTurnBlocks(state, [stale], null, 'ok, keep going')[0])
      .toMatchObject({ kind: 'section_header', section: plan.section })
  })

  it('a Done turn keeps presenting regardless of its chip text', () => {
    const state = fresh()
    const plan = sectionPlan(state)!
    const blocks = planTurnBlocks(state, [], plan.section, null)
    expect(blocks[0]).toMatchObject({ kind: 'notice', copyId: 'section_incomplete' })
  })
})
