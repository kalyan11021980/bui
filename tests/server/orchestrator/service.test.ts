import { describe, it, expect } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { runTurn } from '@/server/orchestrator/service'
import { LOCAL_PROVIDER_NAME } from '@/server/orchestrator/model'
import { toOrchestratorView } from '@/domain/orchestrator/view'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import type { RequirementKey } from '@/domain/requirements/key'
import type { Section } from '@/domain/section'
import type { Turn } from '@/domain/orchestrator/transcript'
import { stubModel } from './stub-model'

const AT = '2026-08-03T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
  bizCountry: null,
}
// tax_id is only required for a business applicant — needed to exercise
// sensitive-field suppression, since explain(tax_id) is only reachable once
// tax_id is actually outstanding.
const BUSINESS_PROFILE = { ...PROFILE, applicantType: 'business' as const }

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }
function freshBusiness(): ApplicationState {
  return createApplication('app-1', BUSINESS_PROFILE, 'tok')
}

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

async function run(
  text: string,
  calls: Parameters<typeof stubModel>[1],
  state = fresh(),
  transcript: readonly Turn[] = [],
  doneWith: Section | null = null,
  userText: string | null = null,
) {
  return runTurn({
    model: stubModel(text, calls),
    view: toOrchestratorView(state, []),
    state, transcript, uploadedDocs: [], userText,
    isResume: false, at: AT, effort: 'low', isAnthropic: false, doneWith,
  })
}

const EXPLAIN_FIRST_NAME = [{ toolName: 'explain', input: { fieldId: 'first_name' } }]

describe('runTurn', () => {
  it('keeps voice that passes the lint', async () => {
    const { turn } = await run('Right — a couple more.', EXPLAIN_FIRST_NAME)
    expect(turn.voice).toBe('Right — a couple more.')
    expect(turn.voiceDropped).toBeUndefined()
  })

  it('drops voice that fails the lint and records why', async () => {
    const { turn } = await run('You have 3 things left.', EXPLAIN_FIRST_NAME)
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('lint')
  })

  it('drops model narration on a rationale-only turn and leads with the vetted intro', async () => {
    // The applicant asks "why do you ask what best describes you?". The plan
    // adds nothing (a why-question gets its answer alone), so the turn's only
    // block is the rationale the model emits. The model narrates "Let me look
    // that up for you." before its explain call — filler the voice-lint's
    // negative list cannot see. A why-answer is vetted-only: the narration is
    // dropped and rationale_intro leads, instead of the model's words standing
    // in for the vetted lead-in.
    const { turn } = await run('Let me look that up for you.', [
      { toolName: 'explain', input: { fieldId: 'applicant_type' } },
    ], fresh(), [], null, 'why do you ask what best describes me?')
    expect(turn.voice).toBeNull()
    expect(turn.blocks[0]).toEqual({ kind: 'notice', copyId: 'rationale_intro' })
    expect(turn.blocks).toContainEqual({ kind: 'rationale', fieldId: 'applicant_type' })
  })

  it('suppresses voice when an accepted rationale touches a sensitive field, framing it with the vetted intro alone (group still on screen)', async () => {
    // A sensitive rationale always drops voice, so it would also satisfy the
    // sensitive-drop fallback below — without a guard there, the applicant
    // sees two contradictory notices ("keep going with what's left" then
    // "here's why we ask") stacked above one rationale block. The profile
    // group is also presented this turn (a fresh application, nothing on
    // screen yet) — the intro leads regardless.
    const { turn } = await run('Here is why we ask.', [
      { toolName: 'explain', input: { fieldId: 'tax_id' } },
    ], freshBusiness())
    expect(turn.blocks).toContainEqual({ kind: 'rationale', fieldId: 'tax_id' })
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('sensitive')
    expect(turn.blocks[0]).toEqual({ kind: 'notice', copyId: 'rationale_intro' })
    expect(turn.blocks).not.toContainEqual({ kind: 'notice', copyId: 'guard_fallback' })
  })

  it('suppresses voice when the accepted document_request backs a sensitive field', async () => {
    // drivers_license is PROFILE's idForm, so it is in documentsToUpload
    // already, and it backs dl_number/dob — both sensitive.
    const { turn } = await run('Photograph it for me.', [
      { toolName: 'requestDocument', input: { docType: 'drivers_license' } },
    ])
    expect(turn.blocks).toContainEqual({ kind: 'document_request', docType: 'drivers_license' })
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('sensitive')
  })

  it('leads with guard_fallback when the rationale intro sits behind another block', async () => {
    // requestDocument survives first, so the rationale intro (framed just
    // ahead of the rationale) is not at the turn's front — guard_fallback
    // still belongs there, leading everything. Section already on screen so
    // the planner adds nothing behind it.
    const state = answeredExcept(['dl_number'])
    const presented: Turn = {
      seq: 1, at: AT, role: 'agent', voice: null,
      blocks: [{ kind: 'section_header', section: 'identification', done: 0, total: 1 }],
    }
    const { turn } = await run('Photograph it, and here is why.', [
      { toolName: 'requestDocument', input: { docType: 'drivers_license' } },
      { toolName: 'explain', input: { fieldId: 'dl_number' } },
    ], state, [presented])
    expect(turn.blocks).toEqual([
      { kind: 'notice', copyId: 'guard_fallback' },
      { kind: 'document_request', docType: 'drivers_license' },
      { kind: 'notice', copyId: 'rationale_intro' },
      { kind: 'rationale', fieldId: 'dl_number' },
    ])
  })

  it('keeps voice for a document_request that backs no sensitive field', async () => {
    // dealer_license backs only business/license fields, none of which are
    // marked sensitive — the contrast case that proves suppression is keyed
    // on the document, not merely "any document_request".
    const licensedProfile = { ...PROFILE, licenses: ['dealer' as const] }
    const state = createApplication('app-1', licensedProfile, 'tok')
    const { turn } = await run('Right — a couple more.', [
      { toolName: 'requestDocument', input: { docType: 'dealer_license' } },
    ], state)
    expect(turn.blocks).toContainEqual({ kind: 'document_request', docType: 'dealer_license' })
    expect(turn.voice).toBe('Right — a couple more.')
    expect(turn.voiceDropped).toBeUndefined()
  })

  it('drops a rejected tool call and records its code', async () => {
    // proof_of_residency is never owed by PROFILE (addressDiffersFromId is
    // false) — a guaranteed guard-reject, whatever else is on the record.
    const { turn, rejections } = await run('Sure.', [
      { toolName: 'requestDocument', input: { docType: 'proof_of_residency' } },
    ])
    expect(rejections).toContain('document_not_required')
    expect(turn.blocks).not.toContainEqual({ kind: 'document_request', docType: 'proof_of_residency' })
  })

  it('applies surviving calls even when a sibling was rejected', async () => {
    // Same setup as "falls back to the vetted line alone" below (blank text,
    // a section already on screen so the planner adds nothing) — there, zero
    // surviving calls leaves blocks empty and the fallback fires. Here one
    // call survives, so its block must stand in and suppress the fallback,
    // or "correctly withheld" and "never offered" look identical. Blank text
    // means no voice, so the surviving rationale gets the vetted intro too.
    const state = answeredExcept(['addr_city'])
    const presented: Turn = {
      seq: 1, at: AT, role: 'agent', voice: null,
      blocks: [{ kind: 'section_header', section: 'address', done: 0, total: 1 }],
    }
    const { turn, rejections } = await run('', [
      { toolName: 'explain', input: { fieldId: 'addr_city' } },
      { toolName: 'requestDocument', input: { docType: 'proof_of_residency' } },
    ], state, [presented])
    expect(turn.blocks).toEqual([
      { kind: 'notice', copyId: 'rationale_intro' },
      { kind: 'rationale', fieldId: 'addr_city' },
    ])
    expect(rejections).toEqual(['document_not_required'])
  })

  it('never says "keep going with what\'s left" when nothing is left', async () => {
    // The completion moment: every field answered, the model says so with no
    // tool calls. The fallback notice under that voice would contradict it.
    const state = answeredExcept([])
    const { turn } = await run('Everything looks to be in order.', [], state)
    expect(turn.voice).toBe('Everything looks to be in order.')
    expect(turn.blocks).toEqual([])
  })

  it('numbers the turn from the highest existing seq, not the transcript length', async () => {
    // Seqs start above the array length — a windowed transcript (fewer
    // entries than the record) must not renumber onto a seq that already exists.
    const prior: Turn[] = [
      { seq: 5, at: AT, role: 'agent', voice: null, blocks: [] },
      { seq: 6, at: AT, role: 'applicant', voice: null, blocks: [], text: 'hi' },
    ]
    const { turn } = await run('Sure.', EXPLAIN_FIRST_NAME, fresh(), prior)
    expect(turn.seq).toBe(7)
  })

  // The planner, not the model, decides what group of questions is on
  // screen this turn.
  describe('plan-driven turns', () => {
    it('a turn with no tool calls still presents the planned group', async () => {
      const state = answeredExcept(['addr_city'])
      const { turn } = await run('Here is the next part.', [], state)
      expect(turn.blocks[0]).toMatchObject({ kind: 'section_header', section: 'address' })
      expect(turn.blocks).toContainEqual({ kind: 'field_ask', fieldId: 'addr_city' })
      expect(turn.voice).toBe('Here is the next part.')
    })

    it('does not re-present the section the applicant is already looking at', async () => {
      const state = answeredExcept(['addr_city'])
      const presented: Turn = {
        seq: 1, at: AT, role: 'agent', voice: null,
        blocks: [{ kind: 'section_header', section: 'address', done: 0, total: 1 }],
      }
      // The section is already on screen, so the planner adds nothing and the
      // turn is rationale-only. "It is for your records." is the model
      // authoring why-prose, which a rationale-only turn drops in favour of
      // the vetted intro — no section_header re-presented either way.
      const { turn } = await run('It is for your records.', [
        { toolName: 'explain', input: { fieldId: 'addr_city' } },
      ], state, [presented])
      expect(turn.voice).toBeNull()
      expect(turn.blocks).toEqual([
        { kind: 'notice', copyId: 'rationale_intro' },
        { kind: 'rationale', fieldId: 'addr_city' },
      ])
    })

    it('a gapped Done re-presents the missing fields behind the notice', async () => {
      const state = answeredExcept(['addr_city', 'addr_zip'])
      const presented: Turn = {
        seq: 1, at: AT, role: 'agent', voice: null,
        blocks: [{ kind: 'section_header', section: 'address', done: 0, total: 2 }],
      }
      const { turn } = await run('Nearly there.', [], state, [presented], 'address')
      expect(turn.blocks[0]).toEqual({ kind: 'notice', copyId: 'section_incomplete' })
      expect(turn.blocks[1]).toMatchObject({ kind: 'section_header', section: 'address' })
    })

    it('a setProfile this turn reshapes the plan it presents', async () => {
      const state = answeredExcept([])          // nothing outstanding as individual
      const { turn, actions } = await run('Noted.', [
        { toolName: 'setProfile', input: { patch: { applicantType: 'business' } } },
      ], state)
      expect(actions).toHaveLength(1)
      // business profile re-opens business/tax requirements — the group presented
      // must come from the post-action state, not the stale one.
      expect(turn.blocks.some((b) => b.kind === 'section_header')).toBe(true)
    })

    it('sensitive fields in the group suppress voice and stand the fallback line in', async () => {
      const state = answeredExcept(['dl_number'])
      const { turn } = await run('One more thing.', [], state)
      expect(turn.voice).toBeNull()
      expect(turn.voiceDropped).toBe('sensitive')
      expect(turn.blocks[0]).toEqual({ kind: 'notice', copyId: 'guard_fallback' })
    })

    it('a voice-only reply mid-section is a legal turn — no fallback appended', async () => {
      const state = answeredExcept(['addr_city'])
      const presented: Turn = {
        seq: 1, at: AT, role: 'agent', voice: null,
        blocks: [{ kind: 'section_header', section: 'address', done: 0, total: 1 }],
      }
      const { turn } = await run('Take your time.', [], state, [presented])
      expect(turn.voice).toBe('Take your time.')
      expect(turn.blocks).toEqual([])
    })

    it('a whiffed turn mid-section falls back to the vetted line alone', async () => {
      const state = answeredExcept(['addr_city'])
      const presented: Turn = {
        seq: 1, at: AT, role: 'agent', voice: null,
        blocks: [{ kind: 'section_header', section: 'address', done: 0, total: 1 }],
      }
      const { turn } = await run('', [], state, [presented])
      expect(turn.blocks).toEqual([{ kind: 'notice', copyId: 'guard_fallback' }])
    })

    it('the final Done is contradiction-free — no blocks, no fallback', async () => {
      const state = answeredExcept([])
      const { turn } = await run('All set.', [], state, [], 'contact')
      expect(turn.blocks).toEqual([])
      expect(turn.voice).toBe('All set.')
    })
  })
})

describe('effort', () => {
  /** Captures what generateText actually put on the wire. */
  async function optionsFor(isAnthropic: boolean, effort: string) {
    let seen: unknown
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        seen = options.providerOptions
        return {
          content: [{ type: 'text' as const, text: 'Sure.' }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: {
            inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: undefined, text: undefined, reasoning: undefined },
          },
          warnings: [],
        }
      },
    })
    const state = fresh()
    await runTurn({
      model, view: toOrchestratorView(state, []), state,
      transcript: [], uploadedDocs: [], userText: null,
      isResume: false, at: AT, effort, isAnthropic, doneWith: null,
    })
    return seen as Record<string, Record<string, unknown>> | undefined
  }

  it('sends effort to anthropic under its own key', async () => {
    expect(await optionsFor(true, 'high')).toEqual({ anthropic: { effort: 'high' } })
  })

  // A local reasoning model spends most of its output on hidden thinking —
  // measured at two thirds of generated tokens, and five times the latency —
  // and only reaches the applicant as a slower turn. The effort setting was
  // anthropic-only, so there was no way to turn that off.
  it('sends effort to a local provider as its reasoning effort', async () => {
    expect(await optionsFor(false, 'none')).toEqual({
      [LOCAL_PROVIDER_NAME]: { reasoningEffort: 'none' },
    })
  })
})
