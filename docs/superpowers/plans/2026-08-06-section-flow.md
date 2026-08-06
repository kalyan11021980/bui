# Section-Driven Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The conversation walks the catalog's sections in fixed order, one titled group of field cards at a time, advanced only by an applicant-pressed "Done with this section" — the model narrates but no longer decides what is asked or when.

**Architecture:** A pure server-side planner (`src/domain/orchestrator/plan.ts`) derives the current section from `outstandingFields` — never stored, so answering moves it forward and clearing moves it back. `runTurn` appends the planner's blocks to every turn that needs a presentation; the model keeps `explain`/`setProfile`/`requestDocument` but loses `askFor`. A `doneWith: Section` intent on the turn route is the only advancer; the idle nudge is deleted.

**Tech Stack:** Next.js App Router, AI SDK v5 (`generateText`, one step), zod 3.23, vitest + testing-library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-05-section-flow-design.md`. One deliberate deviation, agreed during planning: the spec renders the Done bar "while the newest group's section still has outstanding fields" — that strands the applicant, because a fully-answered section would hide the bar and Done is the only way to summon the next group. Corrected condition: **the bar renders while a group has been presented and anything is outstanding anywhere; it yields to `CompletionCard` when nothing is.**

## Global Constraints

- `COPY_VERSION` bumps exactly once, `'5'` → `'6'`, in Task 1. No other task touches it.
- New applicant-visible fixed strings are vetted copy ids (`done_chip`, `section_incomplete`) — never string literals in components. Section titles come from the existing `SECTION_LABEL`.
- Interim wordings join the legal copy batch — note them in the PR description, do not invent alternates.
- `src/domain` must not import `ai` (enforced by `tests/domain/purity.test.ts`).
- No element that can hold focus is ever given `disabled` (§9.1); refuse the action instead.
- Every new test runs RED first — run it and paste the failure before implementing. A test that cannot fail is a plan failure (see memory: 10 of 12 briefs once shipped one).
- Sabotage checks run after GREEN **and after commit** — never against uncommitted fixes.
- Every task ends with `npx tsc --noEmit` and pastes its output — a typecheck failure leaves no trace in a diff.
- Comments: short and sparse, matching the codebase's voice; constraints only, no narration.
- Execution: fresh branch `feat/section-flow` in an isolated worktree (superpowers:using-git-worktrees).

---

### Task 1: Vetted copy v6 — `done_chip`, `section_incomplete`

**Files:**
- Modify: `src/domain/orchestrator/copy.ts`
- Test: `tests/domain/orchestrator/copy.test.ts`

**Interfaces:**
- Produces: copy ids `'done_chip'` and `'section_incomplete'` in `VettedCopyId`; `COPY_VERSION === '6'`. Later tasks resolve them via the existing `vettedCopy(id)`.

- [ ] **Step 1: Write the failing test** — add to `tests/domain/orchestrator/copy.test.ts`:

```ts
it('carries the section-flow copy under version 6', () => {
  expect(COPY_VERSION).toBe('6')
  expect(vettedCopy('done_chip')).toBe("Done with this section — what's next?")
  expect(vettedCopy('section_incomplete')).toBe(
    "A few answers in this section are still blank — they're marked below.",
  )
})
```

(Import `COPY_VERSION` alongside the test file's existing imports if not already there.)

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/domain/orchestrator/copy.test.ts`
Expected: FAIL — `done_chip` is not a valid copy id / version is `'5'`.

- [ ] **Step 3: Implement** — in `src/domain/orchestrator/copy.ts`: set `COPY_VERSION = '6'`; append `'done_chip'` and `'section_incomplete'` to `ALL_COPY_IDS`; add to `COPY`:

```ts
  done_chip: "Done with this section — what's next?",

  section_incomplete:
    "A few answers in this section are still blank — they're marked below.",
```

Both are interim wordings — the existing comment style in this file already says the legal batch is tracked in the PR, follow it.

- [ ] **Step 4: Run the whole suite** — the version bump feeds the shown-copy hash; other tests may assert `v5`.

Run: `npx vitest run`
Expected: PASS after updating any test that hard-codes the version string (e.g. `tests/domain/orchestrator/transcript.test.ts` material assertions). Update those assertions to `v6` — nothing else about them.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add src/domain/orchestrator/copy.ts tests/domain/orchestrator/copy.test.ts tests/domain/orchestrator/transcript.test.ts
git commit -m "feat(copy): done_chip and section_incomplete under version 6"
```

---

### Task 2: The `section_header` block, everywhere a block is interpreted

**Files:**
- Modify: `src/domain/orchestrator/transcript.ts` (union + `shownCopyMaterial`)
- Modify: `src/server/orchestrator/prompt.ts` (`describeBlocks`)
- Modify: `src/ui/chat/blocks.tsx` (render case)
- Test: `tests/domain/orchestrator/transcript.test.ts`, `tests/server/orchestrator/prompt.test.ts`, `tests/ui/chat/blocks.test.tsx`

**Interfaces:**
- Produces: `{ kind: 'section_header'; section: Section; done: number; total: number }` as a `Block` member. `done`/`total` are answered-vs-all counts for the fields whose section this is.
- Consumes: `Section`, `SECTION_LABEL` from `src/domain/section.ts`.

Note: `blocks.tsx` has an exhaustiveness check (`const exhaustive: never = block`) — adding the union member without the render case fails the build, so all three interpreters land in this one task.

- [ ] **Step 1: Write the failing tests**

In `tests/domain/orchestrator/transcript.test.ts`:

```ts
it('folds a section header into the shown-copy material, label included', () => {
  const material = shownCopyMaterial(
    [{ kind: 'section_header', section: 'address', done: 1, total: 4 }],
    () => 'unused',
  )
  expect(material).toBe('v6|section:address:Address:1/4')
})
```

In `tests/server/orchestrator/prompt.test.ts` (follow the file's existing pattern for driving `messagesFor` with a transcript):

```ts
it('describes a presented section to the model', () => {
  const turn: Turn = {
    seq: 1, at: AT, role: 'agent', voice: null,
    blocks: [{ kind: 'section_header', section: 'address', done: 1, total: 4 }],
  }
  const messages = messagesFor(view, [turn], null)
  const assistant = messages.find((m) => m.role === 'assistant')
  expect(assistant?.content).toContain('presented section: address (1 of 4 answered)')
})
```

In `tests/ui/chat/blocks.test.tsx` (follow the file's existing render helper):

```tsx
it('renders a section header as its label and progress', () => {
  render(
    <BlockView
      block={{ kind: 'section_header', section: 'address', done: 1, total: 4 }}
      state={state} seq={1}
      onChange={noop} onClear={noop} onConfirm={noop} onReadDocument={noop}
    />,
  )
  expect(screen.getByRole('heading', { name: 'Address' })).toBeInTheDocument()
  expect(screen.getByText('1 of 4 answered')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run them, verify each fails**

Run: `npx vitest run tests/domain/orchestrator/transcript.test.ts tests/server/orchestrator/prompt.test.ts tests/ui/chat/blocks.test.tsx`
Expected: FAIL — type error on the unknown block kind (a compile failure in a RED run counts; note it).

- [ ] **Step 3: Implement**

`src/domain/orchestrator/transcript.ts` — add to the union and the material switch:

```ts
import { SECTION_LABEL, type Section } from '../section'
```
```ts
  | { kind: 'section_header'; section: Section; done: number; total: number }
```
```ts
      case 'section_header':
        return `section:${b.section}:${SECTION_LABEL[b.section]}:${b.done}/${b.total}`
```

`src/server/orchestrator/prompt.ts` — in `describeBlocks`:

```ts
      case 'section_header':
        return `presented section: ${b.section} (${b.done} of ${b.total} answered)`
```

`src/ui/chat/blocks.tsx` — new case before `default` (import `SECTION_LABEL` from `@/domain/section`):

```tsx
    case 'section_header': {
      const { section, done, total } = block
      return (
        <div className="mt-4 mb-1">
          <h3 className="m-0 text-[13px] font-bold uppercase tracking-wide">
            {SECTION_LABEL[section]}
          </h3>
          <p className="m-0 text-[13px] text-text-secondary">{done} of {total} answered</p>
        </div>
      )
    }
```

("answered" is a chrome string, same standing as "Thinking…" — the chrome-vetting question is already parked with Kaly; do not add copy ids for it here.)

- [ ] **Step 4: Run the three test files, then the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add src/domain/orchestrator/transcript.ts src/server/orchestrator/prompt.ts src/ui/chat/blocks.tsx tests/
git commit -m "feat(transcript): section_header block — union, material, prompt, render"
```

---

### Task 3: The planner — `src/domain/orchestrator/plan.ts`

**Files:**
- Create: `src/domain/orchestrator/plan.ts`
- Test: `tests/domain/orchestrator/plan.test.ts` (new)

**Interfaces:**
- Consumes: `outstandingFields` (`@/domain/application/queries`), `requiredFields` (`@/domain/requirements/engine`), `fieldDef` (`@/domain/catalog`), `parseReqKey`, `Section`, `Block`, `Turn`.
- Produces (later tasks call these exact signatures):
  - `SECTION_ORDER: readonly ['profile','identification','address','contact','business','license','tax','gsa','state_forms']`
  - `sectionPlan(state: ApplicationState): { section: Section; fieldIds: readonly RequirementKey[] } | null`
  - `sectionProgress(state: ApplicationState, section: Section): { done: number; total: number }`
  - `lastPresentedSection(transcript: readonly Turn[]): Section | null`
  - `planTurnBlocks(state: ApplicationState, transcript: readonly Turn[], doneWith: Section | null): Block[]`

- [ ] **Step 1: Write the failing tests** — `tests/domain/orchestrator/plan.test.ts`. Use the same builders as `guard.test.ts`: `createApplication('app-1', PROFILE, 'tok')` and `applicationReducer` with `SET_VALUE` (`source: 'user'`). Two helpers at the top:

```ts
const AT = '2026-08-06T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }

/** Answers every outstanding field except `keep`, looping until stable. */
function answeredExcept(keep: readonly RequirementKey[]): ApplicationState {
  let state = fresh()
  for (;;) {
    const next = outstandingFields(state).find((id) => !keep.includes(id))
    if (!next) return state
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: next, value: 'x', source: 'user', at: AT,
    })
  }
}

function answer(state: ApplicationState, fieldId: RequirementKey): ApplicationState {
  return applicationReducer(state, {
    type: 'SET_VALUE', fieldId, value: 'x', source: 'user', at: AT,
  })
}

const header = (section: Section, done = 0, total = 1): Turn => ({
  seq: 1, at: AT, role: 'agent', voice: null,
  blocks: [{ kind: 'section_header', section, done, total }],
})
```

The tests:

```ts
describe('SECTION_ORDER', () => {
  it('covers every section exactly once, in declaration order', () => {
    expect([...SECTION_ORDER]).toEqual(Object.keys(SECTION_LABEL))
  })
})

describe('sectionPlan', () => {
  it('picks the earliest section with outstanding fields, and all of them', () => {
    const state = answeredExcept(['city', 'phone'])   // address before contact
    const plan = sectionPlan(state)
    expect(plan).toEqual({ section: 'address', fieldIds: ['city'] })
  })

  it('moves back when a field is cleared', () => {
    const state = answer(answeredExcept(['phone']), 'phone')
    const reopened = applicationReducer(state, { type: 'CLEAR_VALUE', fieldId: 'city', at: AT })
    expect(sectionPlan(reopened)?.section).toBe('address')
  })

  it('is null when nothing is outstanding', () => {
    expect(sectionPlan(answeredExcept([]))).toBeNull()
  })
})

describe('sectionProgress', () => {
  it('counts answered against all required fields of the section', () => {
    const state = answeredExcept(['city', 'zip'])
    const before = sectionProgress(state, 'address')
    expect(before.total - before.done).toBe(2)
    const after = sectionProgress(answer(state, 'city'), 'address')
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
    const state = answeredExcept(['city'])
    const blocks = planTurnBlocks(state, [], null)
    expect(blocks[0]).toMatchObject({ kind: 'section_header', section: 'address' })
    expect(blocks.slice(1)).toEqual([{ kind: 'field_ask', fieldId: 'city' }])
  })

  it('presents nothing when the current section is already the newest header', () => {
    const state = answeredExcept(['city'])
    expect(planTurnBlocks(state, [header('address')], null)).toEqual([])
  })

  it('re-presents after the plan moves back to an earlier section', () => {
    const state = answeredExcept(['city', 'phone'])
    const blocks = planTurnBlocks(state, [header('contact')], null)
    expect(blocks[0]).toMatchObject({ kind: 'section_header', section: 'address' })
  })

  it('a gapped Done re-presents only the missing fields, behind the vetted notice', () => {
    const state = answeredExcept(['city', 'zip'])
    const blocks = planTurnBlocks(state, [header('address')], 'address')
    expect(blocks[0]).toEqual({ kind: 'notice', copyId: 'section_incomplete' })
    expect(blocks[1]).toMatchObject({ kind: 'section_header', section: 'address' })
    expect(blocks.slice(2)).toEqual([
      { kind: 'field_ask', fieldId: 'city' },
      { kind: 'field_ask', fieldId: 'zip' },
    ])
  })

  it('a complete Done advances to the next section, without the notice', () => {
    const state = answeredExcept(['phone'])          // address done, contact open
    const blocks = planTurnBlocks(state, [header('address')], 'address')
    expect(blocks[0]).toMatchObject({ kind: 'section_header', section: 'contact' })
    expect(blocks.some((b) => b.kind === 'notice')).toBe(false)
  })

  it('the final Done yields no blocks at all', () => {
    expect(planTurnBlocks(answeredExcept([]), [header('contact')], 'contact')).toEqual([])
  })
})
```

If `'city'`/`'zip'`/`'phone'` are not this catalog's field ids, read `src/domain/catalog/address.ts` and `contact.ts` and substitute the real ids — the shape of each assertion stays.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/domain/orchestrator/plan.test.ts`
Expected: FAIL — module `plan.ts` does not exist.

- [ ] **Step 3: Implement** — `src/domain/orchestrator/plan.ts`:

```ts
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

/**
 * The planned half of a turn. A Done always presents (same section's gaps
 * behind the vetted notice, or the next group); otherwise a section is
 * presented only when it is not already the newest one on screen — a typed
 * question mid-section gets its answer and stays put.
 */
export function planTurnBlocks(
  state: ApplicationState,
  transcript: readonly Turn[],
  doneWith: Section | null,
): Block[] {
  const plan = sectionPlan(state)
  if (plan === null) return []

  if (doneWith !== null) {
    const group = groupBlocks(state, plan)
    return plan.section === doneWith
      ? [{ kind: 'notice', copyId: 'section_incomplete' }, ...group]
      : group
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/domain/orchestrator/plan.test.ts && npx vitest run tests/domain/purity.test.ts`
Expected: PASS (purity too — plan.ts imports no `ai`).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add src/domain/orchestrator/plan.ts tests/domain/orchestrator/plan.test.ts
git commit -m "feat(plan): server-side section planner — order, progress, presentation rule"
```

- [ ] **Step 6: Sabotage check (post-commit)** — invert one ordering comparison (e.g. iterate `SECTION_ORDER` reversed) and confirm `sectionPlan` tests fail loudly; revert with `git checkout -- src/domain/orchestrator/plan.ts`.

---

### Task 4: `runTurn` builds turns from the plan

**Files:**
- Modify: `src/server/orchestrator/service.ts`
- Modify: `src/server/orchestrator/tool-set.ts` (drop `askFor` from `activeToolsFor` only)
- Modify: `src/server/orchestrator/prompt.ts` (SYSTEM rewrite)
- Modify: `src/server/application-service.ts` (pass `doneWith: null` for now; degraded path keeps the group)
- Test: `tests/server/orchestrator/service.test.ts`, `tests/server/orchestrator/tool-set.test.ts`, `tests/server/orchestrator/prompt.test.ts`

**Interfaces:**
- Consumes: `planTurnBlocks`, `sectionPlan` from Task 3.
- Produces: `TurnRequest` gains `doneWith: Section | null`. Task 6 will thread the real value; this task passes `null` from `application-service.ts` at both call sites (`runTurnSafely`'s `rest` includes it).

- [ ] **Step 1: Write the failing tests** — rewrite `tests/server/orchestrator/service.test.ts`. Keep the file's harness (`stubModel`, `fresh`, `run`) but: `run` gains `doneWith: Section | null = null` and passes it through; add the `answeredExcept` helper from Task 3 verbatim. Replace every `askFor`-stub test. The new suite:

```ts
it('a turn with no tool calls still presents the planned group', async () => {
  const state = answeredExcept(['city'])
  const { turn } = await run('Here is the next part.', [], state)
  expect(turn.blocks[0]).toMatchObject({ kind: 'section_header', section: 'address' })
  expect(turn.blocks).toContainEqual({ kind: 'field_ask', fieldId: 'city' })
  expect(turn.voice).toBe('Here is the next part.')
})

it('does not re-present the section the applicant is already looking at', async () => {
  const state = answeredExcept(['city'])
  const presented: Turn = {
    seq: 1, at: AT, role: 'agent', voice: null,
    blocks: [{ kind: 'section_header', section: 'address', done: 0, total: 1 }],
  }
  const { turn } = await run('It is for your records.', [
    { toolName: 'explain', input: { fieldId: 'city' } },
  ], state, [presented])
  expect(turn.blocks).toEqual([{ kind: 'rationale', fieldId: 'city' }])
})

it('a gapped Done re-presents the missing fields behind the notice', async () => {
  const state = answeredExcept(['city', 'zip'])
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
  const state = answeredExcept(['city'])
  const presented: Turn = {
    seq: 1, at: AT, role: 'agent', voice: null,
    blocks: [{ kind: 'section_header', section: 'address', done: 0, total: 1 }],
  }
  const { turn } = await run('Take your time.', [], state, [presented])
  expect(turn.voice).toBe('Take your time.')
  expect(turn.blocks).toEqual([])
})

it('a whiffed turn mid-section falls back to the vetted line alone', async () => {
  const state = answeredExcept(['city'])
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
```

Keep the existing lint-drop, explain-sensitive, document_request-sensitive, guard-rejection, and seq tests — they survive with at most a planned-group block appended to their expectations. In `tool-set.test.ts`, change the `activeToolsFor` expectation: `askFor` is never offered (outstanding or not).

- [ ] **Step 2: Run them, verify the new ones fail**

Run: `npx vitest run tests/server/orchestrator/service.test.ts tests/server/orchestrator/tool-set.test.ts`
Expected: FAIL — `doneWith` unknown on `TurnRequest`, groups absent, `askFor` still offered.

- [ ] **Step 3: Implement**

`tool-set.ts` — delete the line `if (view.outstanding.length > 0) active.push('askFor')` (the planner owns asks; `buildToolSet` keeps the schema until Task 5's cleanup so nothing else moves in this diff).

`service.ts`:
- Add `doneWith: Section | null` to `TurnRequest` (import `Section` from `@/domain/section`; import `planTurnBlocks` from `@/domain/orchestrator/plan`, `applicationReducer` from `@/domain/application/reducer`, `applyCarry` from `@/domain/application/carry`).
- Delete the `asked` set, `droppedReAsk`, and the old empty-blocks fallback (`guard_fallback` + next-outstanding ask). The tool-call loop keeps only: guard, push blocks, push actions, push rejections.
- After the loop:

```ts
  // The plan reads the state as it will be once this turn's actions commit —
  // a setProfile this turn reshapes what is asked this same turn.
  const planState = actions.reduce(
    (s, a) => applyCarry(applicationReducer(s, a), request.at).state,
    request.state,
  )
  blocks.push(...planTurnBlocks(planState, request.transcript, request.doneWith))

  const voice = decideVoice(result.text, blocks)

  // A turn with nothing to show and nothing to say reads as a broken page;
  // the vetted line stands in — unless nothing is outstanding, where it
  // would be false copy.
  if (blocks.length === 0 && voice.text === null
      && outstandingFields(planState).length > 0) {
    blocks.push({ kind: 'notice', copyId: 'guard_fallback' })
  }
```

- The sensitive-voice `unshift` of `guard_fallback` stays exactly as is.

`application-service.ts` — `runTurnSafely`'s catch must still produce the titled group (spec §10: a dead model presents correctly):

```ts
    return {
      turn: {
        seq,
        at: rest.at,
        role: 'agent',
        voice: null,
        blocks: [
          { kind: 'notice', copyId: 'degraded_notice' },
          ...planTurnBlocks(rest.state, rest.transcript, rest.doneWith),
        ],
      },
      actions: [],
      rejections: [],
    }
```

and `applyTurn` passes `doneWith: null` in the `runTurnSafely` call's `rest` for now (Task 6 threads the real value).

`prompt.ts` — replace `SYSTEM` wholesale:

```ts
const SYSTEM = [
  "You are the registration agent for IAA's buyer onboarding.",
  '',
  'The system walks the application one section at a time and places each section\'s questions on the applicant\'s screen alongside your reply. You narrate; you never author the words that explain why something is required — those come from a vetted catalog.',
  '',
  'Rules you cannot break:',
  '- You never see and never ask for the applicant\'s answers. Values are entered in the panel beside you.',
  '- You cannot ask questions yourself. The section\'s questions are placed for you.',
  '- Your own words go in one or two short sentences, and must contain no numerals, no percentages, no statute references, and no statements about legal obligation.',
  '- You do not decide when the application is complete.',
  '',
  'Call a tool only when one is called for: explain when the applicant asks why something is needed, setProfile the moment they tell you who they are, requestDocument when a photo would answer a section faster than typing. A reply with no tool call is normal.',
  '',
  'Warm, plain, unhurried.',
].join('\n')
```

(The old "every reply must include a tool call" directive existed because a wordless model turn used to mean an empty screen — the planner has made zero-tool-call the designed-for case. See memory `orchestrator-needs-explicit-tool-directive`; this rewrite retires it deliberately.)

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS. Integration tests that assumed model-driven asks (`turn-route`, `degraded-mode`, `complete-registration`, `resume`, `pii-boundary`) may break here — fix their expectations in this task only where the break is mechanical (a group block where an ask was); anything structural waits for Task 10.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add -A src tests
git commit -m "feat(agent): turns are built from the plan — the model narrates, the planner asks"
```

- [ ] **Step 6: Sabotage check (post-commit)** — make `planState` ignore `actions` (use `request.state` directly) and confirm the setProfile-reshapes test fails; revert.

---

### Task 5: `askFor` leaves the vocabulary

**Files:**
- Modify: `src/domain/orchestrator/tools.ts`, `src/domain/orchestrator/guard.ts`, `src/server/orchestrator/tool-set.ts`, `src/server/application-service.ts`
- Test: `tests/domain/orchestrator/tools.test.ts`, `tests/domain/orchestrator/guard.test.ts`

**Interfaces:**
- Produces: `ALL_TOOL_NAMES = ['explain','setProfile','requestDocument','orient']`; `RejectionCode` loses `'ask_cardinality' | 'field_not_outstanding' | 'duplicate_field' | 'already_asked'` (`'unknown_field'` stays — `explain` uses it).

- [ ] **Step 1: Write the failing test** — in `guard.test.ts`, replace the `askFor` rejection tests with:

```ts
it('rejects askFor outright — the planner owns asks now', () => {
  expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name'] } }))
    .toBe('unknown_tool')
})
```

In `tools.test.ts`, update the vocabulary assertion to the four remaining names.

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run tests/domain/orchestrator/guard.test.ts tests/domain/orchestrator/tools.test.ts`
Expected: FAIL — askFor still guards to blocks.

- [ ] **Step 3: Implement**
  - `tools.ts`: remove `'askFor'` from `ALL_TOOL_NAMES`; remove its entries from `TOOL_SCHEMAS` and `TOOL_DESCRIPTIONS`.
  - `guard.ts`: delete the `case 'askFor'` arm; prune `'ask_cardinality' | 'field_not_outstanding' | 'duplicate_field' | 'already_asked'` from `RejectionCode` (persisted turns store rejections as plain strings — nothing re-parses them).
  - `tool-set.ts`: remove the `askFor` entry from `buildToolSet`.
  - `application-service.ts`: the `already_asked` misbehaviour filter is now dead — `const misbehaviour = result.rejections` (keep the surrounding threshold logic and trim the comment accordingly).

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS (update any remaining test that references a pruned code).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add -A src tests
git commit -m "feat(agent): askFor leaves the tool set — unknown_tool on sight"
```

---

### Task 6: `doneWith` through the server — service intent and route validation

**Files:**
- Modify: `src/server/application-service.ts`
- Modify: `src/app/api/application/[id]/turn/route.ts`
- Test: `tests/integration/turn-route.test.ts`

**Interfaces:**
- Consumes: `SECTION_ORDER` (Task 3), `vettedCopy('done_chip')` (Task 1), `TurnRequest.doneWith` (Task 4).
- Produces: `TurnInput` gains `doneWith: Section | undefined`; `POST …/turn` accepts `{ text }` **or** `{ doneWith }`, exactly one, `text` non-blank. (Verified during planning: the route always sends `isResume: false` and the only text-less caller was the nudge — nothing else posts `{}`.)

- [ ] **Step 1: Write the failing tests** — in `turn-route.test.ts`, following the file's existing request-building pattern:

```ts
it('rejects a body with neither text nor doneWith', async () => {
  const response = await postTurn(id, token, {})
  expect(response.status).toBe(400)
})

it('rejects a body with both text and doneWith', async () => {
  const response = await postTurn(id, token, { text: 'hi', doneWith: 'address' })
  expect(response.status).toBe(400)
})

it('rejects blank text', async () => {
  const response = await postTurn(id, token, { text: '   ' })
  expect(response.status).toBe(400)
})

it('rejects a doneWith outside the Section union', async () => {
  const response = await postTurn(id, token, { doneWith: 'bogus' })
  expect(response.status).toBe(400)
})

it('a Done commits an applicant turn in vetted copy and answers with the agent turn', async () => {
  const response = await postTurn(id, token, { doneWith: 'profile' })
  expect(response.status).toBe(200)
  const { state, turn } = await response.json()
  const applicant = state.transcript.at(-2)
  expect(applicant.role).toBe('applicant')
  expect(applicant.text).toBe("Done with this section — what's next?")
  expect(turn.role).toBe('agent')
})
```

(Match the file's actual helper names/HTTP plumbing; the assertions stand. Adjust the previous `{}`-accepting nudge test — it now expects 400.)

- [ ] **Step 2: Run, verify the new ones fail**

Run: `npx vitest run tests/integration/turn-route.test.ts`
Expected: FAIL — `{}` currently 200s, `doneWith` is rejected by `.strict()`.

- [ ] **Step 3: Implement**

`route.ts`:

```ts
import { SECTION_ORDER } from '@/domain/orchestrator/plan'
```
```ts
const bodySchema = z
  .object({
    text: z.string().optional(),
    doneWith: z.enum(SECTION_ORDER).optional(),
  })
  .strict()
  .refine((body) => (body.text !== undefined) !== (body.doneWith !== undefined), {
    message: 'exactly one of text or doneWith',
  })
  .refine((body) => body.text === undefined || body.text.trim() !== '', {
    message: 'text must not be blank',
  })
```

and pass `doneWith: parsed.data.doneWith` into `applyTurn`. (If zod 3.23 balks at the readonly tuple, `z.enum([...SECTION_ORDER] as [Section, ...Section[]])`.)

`application-service.ts` — `TurnInput` gains `doneWith: Section | undefined` (import `Section`, `vettedCopy`). In `applyTurn`, after the `text` normalisation:

```ts
  const doneWith = input.doneWith ?? null
  // The route enforces exactly-one; a second caller must not slip past it.
  if (text && doneWith) {
    return { ok: false, failure: failure('malformed', 'exactly one of text or doneWith') }
  }
  const applicantText = text ?? (doneWith ? vettedCopy('done_chip') : null)
```

Then use `applicantText` where `text` gated the `APPEND_TURN` and as `userText`, and pass `doneWith` in the `runTurnSafely` `rest` (replacing Task 4's `null`).

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add src/server/application-service.ts src/app/api/application/[id]/turn/route.ts tests/integration/turn-route.test.ts
git commit -m "feat(turn): doneWith intent — validated on the route, committed as vetted applicant copy"
```

---

### Task 7: `doneWith` from the browser — API client and `useConversation`

**Files:**
- Modify: `src/ui/client/application-api.ts`
- Modify: `src/ui/client/useConversation.ts`
- Test: `tests/ui/client/useConversation.test.ts`

**Interfaces:**
- Produces: `sendTurn(id, ownerToken, payload: TurnPayload)` where `export type TurnPayload = { text: string } | { doneWith: Section }`; `UseConversation` gains `sendDone: (section: Section) => void` and **loses `nudge`**. Task 9 consumes `sendDone`.

- [ ] **Step 1: Write the failing tests** — in `useConversation.test.ts`, following its existing fetch-mock pattern:

```ts
it('sendDone posts the section as structured intent, never text', async () => {
  // drive sendDone('address'); then:
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body).toEqual({ doneWith: 'address' })
})

it('sendDone echoes the vetted done line immediately', () => {
  // before the response resolves:
  expect(turns.at(-1)).toMatchObject({
    role: 'applicant',
    text: "Done with this section — what's next?",
  })
})

it('the echo is replaced by the committed turn when the reply lands', async () => {
  // resolve the mocked response carrying the committed applicant turn + agent turn;
  expect(turns.filter((t) => t.role === 'applicant')).toHaveLength(1)
  expect(turns.at(-2)!.seq).toBeGreaterThan(0)
})
```

Delete the nudge tests in this file.

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run tests/ui/client/useConversation.test.ts`
Expected: FAIL — `sendDone` does not exist.

- [ ] **Step 3: Implement**

`application-api.ts` — replace `sendTurn`'s `text: string | null` with:

```ts
export type TurnPayload = { text: string } | { doneWith: Section }

/**
 * The conversation's one outbound call. `text` is the applicant's own words,
 * never a field value; `doneWith` is the structured Done intent — the route
 * accepts exactly one of the two.
 */
export function sendTurn(
  id: string,
  ownerToken: string | null,
  payload: TurnPayload,
): Promise<ApiResult<TurnOutcome>> {
  return post<TurnOutcome>(`/api/application/${id}/turn`, ownerToken, payload)
}
```

(import `Section`; delete the stale nudge comment above it).

`useConversation.ts`:
- `post` takes `TurnPayload`; `send` builds `{ text: trimmed }`; delete `nudge` from the return and the `UseConversation` type (and its doc comment).
- Add (import `vettedCopy`):

```ts
  const sendDone = (section: Section) => {
    localSeq.current -= 1
    setTurns((held) => [...held, applicantTurn(localSeq.current, vettedCopy('done_chip'))])
    post({ doneWith: section })
  }
```

- Return `{ turns, pending, send, sendDone }`. The echo-removal filter (`seq < 0 && role === 'applicant'`) already covers the done echo.

- [ ] **Step 4: Run the suite** — `ConversationShell` still destructures `nudge`, so expect a compile break there; fix it minimally in this task by destructuring only what exists (`useIdleNudge` gets a no-op `() => undefined` until Task 9 deletes it).

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add src/ui/client tests/ui/client src/ui/chat/ConversationShell.tsx
git commit -m "feat(chat): sendDone — the Done intent travels structured, echoed in vetted copy"
```

---

### Task 8: `SectionDoneBar`

**Files:**
- Create: `src/ui/chat/SectionDoneBar.tsx`
- Test: `tests/ui/chat/SectionDoneBar.test.tsx` (new)

**Interfaces:**
- Consumes: `lastPresentedSection` (Task 3), `outstandingFields`, `SECTION_LABEL`.
- Produces: `SectionDoneBar({ state, turns, sendable, onDone })` — `turns: readonly Turn[]`, `onDone: (section: Section) => void`. Task 9 mounts it.

- [ ] **Step 1: Write the failing tests** — `tests/ui/chat/SectionDoneBar.test.tsx`, using the state builders the other chat tests use:

```tsx
const presented = (section: Section): Turn => ({
  seq: 1, at: AT, role: 'agent', voice: null,
  blocks: [{ kind: 'section_header', section, done: 0, total: 1 }],
})

it('renders one Done button for the presented section', () => {
  render(<SectionDoneBar state={state} turns={[presented('address')]} sendable onDone={noop} />)
  expect(screen.getByRole('button', { name: 'Done with this section' })).toBeInTheDocument()
})

it('reports the presented section on press', async () => {
  const onDone = vi.fn()
  render(<SectionDoneBar state={state} turns={[presented('address')]} sendable onDone={onDone} />)
  await userEvent.click(screen.getByRole('button', { name: 'Done with this section' }))
  expect(onDone).toHaveBeenCalledWith('address')
})

it('refuses, never disables, while unsendable', async () => {
  const onDone = vi.fn()
  render(<SectionDoneBar state={state} turns={[presented('address')]} sendable={false} onDone={onDone} />)
  const button = screen.getByRole('button', { name: 'Done with this section' })
  expect(button).not.toBeDisabled()
  await userEvent.click(button)
  expect(onDone).not.toHaveBeenCalled()
})

it('renders nothing before any group is presented', () => {
  const { container } = render(<SectionDoneBar state={state} turns={[]} sendable onDone={noop} />)
  expect(container).toBeEmptyDOMElement()
})

it('renders nothing once everything is answered — the CompletionCard takes over', () => {
  // state with outstandingFields(state).length === 0 (reuse answeredExcept([]))
  const { container } = render(
    <SectionDoneBar state={complete} turns={[presented('contact')]} sendable onDone={noop} />,
  )
  expect(container).toBeEmptyDOMElement()
})

it('renders nothing after submission', () => {
  // state with submittedAt set
  const { container } = render(
    <SectionDoneBar state={submitted} turns={[presented('address')]} sendable onDone={noop} />,
  )
  expect(container).toBeEmptyDOMElement()
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run tests/ui/chat/SectionDoneBar.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — `src/ui/chat/SectionDoneBar.tsx`:

```tsx
'use client'

import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import { lastPresentedSection } from '@/domain/orchestrator/plan'
import type { Turn } from '@/domain/orchestrator/transcript'
import type { Section } from '@/domain/section'

type Props = {
  state: ApplicationState
  /** This session's turns — where the newest presented section is read from. */
  turns: readonly Turn[]
  /** Refused, never disabled — §9.1. */
  sendable: boolean
  onDone: (section: Section) => void
}

/**
 * The one Done on screen, for the current section — fixed UI like the
 * CompletionCard, which it yields to once nothing is outstanding. Always
 * pressable with gaps: the server answers by marking what is missing.
 */
export function SectionDoneBar({ state, turns, sendable, onDone }: Props) {
  if (state.submittedAt !== null) return null
  if (outstandingFields(state).length === 0) return null
  const section = lastPresentedSection(turns)
  if (section === null) return null

  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => { if (sendable) onDone(section) }}
        className="cursor-pointer rounded-full border border-divider bg-surface px-4 py-2 text-[14px] font-semibold text-primary"
      >
        Done with this section
      </button>
    </div>
  )
}
```

("Done with this section" is chrome, same standing as the CompletionCard's button label.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/ui/chat/SectionDoneBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add src/ui/chat/SectionDoneBar.tsx tests/ui/chat/SectionDoneBar.test.tsx
git commit -m "feat(chat): SectionDoneBar — the one Done on screen, for the current section"
```

---

### Task 9: Wire the shell; delete the idle nudge

**Files:**
- Modify: `src/ui/chat/ConversationShell.tsx`
- Modify: `src/ui/client/useApplication.ts`, `src/app/page.tsx` (remove `panelWrites` — nothing else consumes it)
- Delete: `src/ui/client/useIdleNudge.ts`, `tests/ui/client/useIdleNudge.test.ts`
- Test: `tests/ui/chat/ConversationShell.test.tsx`

**Interfaces:**
- Consumes: `SectionDoneBar` (Task 8), `sendDone` (Task 7).

- [ ] **Step 1: Write the failing tests** — in `ConversationShell.test.tsx`:

```tsx
it('mounts the Done bar under the log once a group is on screen', async () => {
  // drive one turn whose response contains a section_header (existing mock pattern)
  expect(await screen.findByRole('button', { name: 'Done with this section' })).toBeInTheDocument()
})

it('never fires a turn unprompted', async () => {
  // render, write to a field (the old nudge trigger), advance timers past 1200ms
  vi.advanceTimersByTime(5000)
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/turn'), expect.anything())
})
```

Delete/adjust the existing nudge tests in this file (there will be some asserting the 1.2 s behaviour).

- [ ] **Step 2: Run, verify the new ones fail**

Run: `npx vitest run tests/ui/chat/ConversationShell.test.tsx`
Expected: FAIL — no Done bar; the nudge still fires.

- [ ] **Step 3: Implement**
  - `ConversationShell.tsx`: destructure `sendDone`; delete the `useIdleNudge` import/call, the `askedOnScreen`/`worthNudging` block and its comment, the `panelWrites` prop and doc comment. Mount between the thinking indicator and the CompletionCard:

```tsx
      <SectionDoneBar state={state} turns={turns} sendable={sendable} onDone={sendDone} />

      <CompletionCard state={state} onSubmit={onSubmit} />
```

  - `useApplication.ts`: remove `panelWrites` from the return type and value, `setPanelWrites`, `noteWrite`, and both `noteWrite()` call sites.
  - `page.tsx`: remove the `panelWrites` prop.
  - Delete `src/ui/client/useIdleNudge.ts` and its test file.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` (paste output)
```bash
git add -A src tests
git commit -m "feat(chat): the Done bar advances the flow — the idle nudge is gone"
```

- [ ] **Step 6: Sabotage check (post-commit)** — make `SectionDoneBar` ignore `sendable` and confirm the refuses-while-unsendable test fails; revert.

---

### Task 10: Integration sweep and the real walk

**Files:**
- Modify: `tests/integration/complete-registration.test.ts`, `tests/integration/degraded-mode.test.ts` (+ any integration test still assuming model-driven asks)

- [ ] **Step 1: Write the failing integration tests**

In `complete-registration.test.ts` — a section-walk leg using the suite's existing route-level helpers:

```ts
it('walks the registration section by section behind the Done gate', async () => {
  // 1. start an application; first turn (text: 'hi') presents the first group
  //    → assert exactly one section_header, matching SECTION_ORDER's first
  //    outstanding section.
  // 2. Done with gaps → assert section_incomplete notice + same section again,
  //    only missing fields.
  // 3. answer that section's fields via the actions route; Done → assert the
  //    NEXT section's header, in SECTION_ORDER order.
  // 4. repeat to the end; final Done → assert turn has no blocks and the
  //    response state has outstandingFields === 0.
  // 5. submit; a further Done → 409.
})
```

In `degraded-mode.test.ts`:

```ts
it('a dead model still presents the titled group', async () => {
  // modelForTurn throws (existing pattern); POST { doneWith } on a state with
  // outstanding fields → turn.blocks[0] is degraded_notice and a
  // section_header follows.
})
```

Write these as real assertions against the suite's actual helpers — the comments above are the required shape, not placeholders to leave in.

- [ ] **Step 2: Run them RED, then implement any fix they surface** — these tests verify composition, so ideally they pass off the bat; if one fails, the defect is in Tasks 4–9 — fix it there (memory: fix, don't defer), re-run.

- [ ] **Step 3: Full verification**

Run: `npx vitest run` — expect all green, paste the count.
Run: `npx tsc --noEmit` — paste output.

- [ ] **Step 4: Commit**

```bash
git add tests/integration
git commit -m "test(integration): the section walk, Done gate, and degraded group"
```

- [ ] **Step 5: Chrome walk (drive it as a real user — memory says 938 green tests once missed four defects a ten-minute walk found)** — on the real dev server (it owns :3000; restart if wedged): license upload → identification group appears with title and progress → Done with gaps shows `section_incomplete` and the missing fields → answer, Done advances through every section in order → CompletionCard → submission. Watch for: two Done buttons, a group re-rendering on a typed question, the echo bubble replaying, focus loss on Done. Record findings; fix on the spot, with a test, before closing the task.

---

## Self-review (done during planning)

- **Spec coverage:** §3 planner → Task 3; §4 turn → Tasks 4–5; §5 Done end-to-end → Tasks 6–8; §6 removals → Task 9; §7 copy → Task 1 (+chrome strings noted); §8 untouched surfaces — no task edits them; §9 layout matches file lists; §10 testing → each task's tests + Task 10.
- **Known deviation:** SectionDoneBar render condition (header of this plan) — flagged to Kaly.
- **Type consistency:** `planTurnBlocks(state, transcript, doneWith)` is the one signature used in Tasks 3, 4, 6; `sendDone(section)` in Tasks 7, 8, 9; `TurnPayload` in Task 7 only.
- **Field-id caveat:** planner tests name `city`/`zip`/`phone` — Task 3's implementer must confirm against the catalog before running RED.
