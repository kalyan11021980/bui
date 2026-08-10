import { describe, it, expect } from 'vitest'
import {
  SECTION_ORDER, sectionPlan, sectionProgress, lastPresentedSection, planTurnBlocks, isFreeQuestion, isGreeting,
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

describe('isFreeQuestion', () => {
  it('accepts why-questions (the original pill templates and typed variants)', () => {
    expect(isFreeQuestion('Why do you need my last name?')).toBe(true)
    expect(isFreeQuestion('Why do you ask "Which ID will you use?"')).toBe(true)
    expect(isFreeQuestion('  WHY is that required')).toBe(true)
    expect(isFreeQuestion('tell me why do you need this')).toBe(true)
    expect(isFreeQuestion('Why?')).toBe(true)
    expect(isFreeQuestion("Why's that needed?")).toBe(true)
  })

  it('accepts other free-form informational questions', () => {
    expect(isFreeQuestion('What all things do you need')).toBe(true)
    expect(isFreeQuestion('how much time it gonna take')).toBe(true)
    expect(isFreeQuestion('What else do you need?')).toBe(true)
    expect(isFreeQuestion('Where does this go')).toBe(true)
    expect(isFreeQuestion('which form of ID do you want')).toBe(true)
    expect(isFreeQuestion('Do you need my license?')).toBe(true)
    expect(isFreeQuestion('Is that required?')).toBe(true)
  })

  it('rejects statements and acks so the form still drives forward', () => {
    expect(isFreeQuestion("I'm ready")).toBe(false)
    expect(isFreeQuestion('ok, keep going')).toBe(false)
    expect(isFreeQuestion('I am an individual from Texas')).toBe(false)
    expect(isFreeQuestion('Tell me why later')).toBe(false)
    // No word boundary between "why" and "ever" — not a why-question.
    expect(isFreeQuestion('Whyever would I mind')).toBe(false)
    // Auxiliary-starter acks are not questions; the form must still present.
    expect(isFreeQuestion('Will do')).toBe(false)
    expect(isFreeQuestion('Is fine with me')).toBe(false)
  })
})

describe('isGreeting', () => {
  it('accepts greetings and casual openers', () => {
    expect(isGreeting('hi')).toBe(true)
    expect(isGreeting('Hi there')).toBe(true)
    expect(isGreeting('hello, I am John')).toBe(true)
    expect(isGreeting('Hey')).toBe(true)
    expect(isGreeting('howdy')).toBe(true)
    expect(isGreeting('good morning')).toBe(true)
    expect(isGreeting("what's up")).toBe(true)
  })

  it('rejects non-greetings so the form still drives forward', () => {
    expect(isGreeting('I am an individual from Texas')).toBe(false)
    expect(isGreeting('ok, keep going')).toBe(false)
    expect(isGreeting('ready')).toBe(false)
    expect(isGreeting("let's start")).toBe(false)
    expect(isGreeting('yes')).toBe(false)
    // Word-boundary guard: "his", "hint", "you", "super" are not greetings.
    expect(isGreeting('his license')).toBe(false)
    expect(isGreeting('hint taken')).toBe(false)
    expect(isGreeting('you need what')).toBe(false)
    expect(isGreeting('sure thing')).toBe(false)
  })
})

describe('planTurnBlocks and free-form questions', () => {
  it('presents nothing for a why-question on an empty transcript', () => {
    const state = fresh()
    expect(planTurnBlocks(state, [], null, 'Why do you ask "What best describes you?"'))
      .toEqual([])
  })

  it('presents nothing for a free-form informational question on an empty transcript', () => {
    // "what all things do you need and how much time will it take" — a genuine
    // question gets its answer alone; the form presents on the next
    // non-question turn, never dumped beside the answer.
    const state = fresh()
    expect(planTurnBlocks(state, [], null, 'what all things do you need and how much time it gonna take'))
      .toEqual([])
  })

  it('still presents the form for a statement first turn', () => {
    const state = fresh()
    const blocks = planTurnBlocks(state, [], null, 'I am an individual from Texas')
    expect(blocks[0]).toMatchObject({ kind: 'section_header' })
  })

  it('presents nothing for a greeting on an empty transcript', () => {
    // "hi" is a conversational opener, not engagement; the agent greets back
    // and the form presents on the next turn, never dumped on the greeting.
    const state = fresh()
    expect(planTurnBlocks(state, [], null, 'hi')).toEqual([])
    expect(planTurnBlocks(state, [], null, 'Hello there')).toEqual([])
  })

  it('presents nothing for a free question even when the plan has advanced', () => {
    // The newest header on screen is an older section; a statement turn would
    // present the current plan section — a question turn must not.
    const state = fresh()
    const plan = sectionPlan(state)!
    const stale: Turn = {
      seq: 1, at: AT, role: 'agent', voice: null,
      blocks: [{ kind: 'section_header', section: 'tax', done: 0, total: 1 }],
    }
    expect(plan.section).not.toBe('tax')
    expect(planTurnBlocks(state, [stale], null, 'why do you need all this')).toEqual([])
    expect(planTurnBlocks(state, [stale], null, 'what else do you need')).toEqual([])
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
