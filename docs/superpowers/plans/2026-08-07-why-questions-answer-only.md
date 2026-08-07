# Why-Questions Get Real Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A why-shaped applicant turn gets its answer without the section dump, tool-narration markers can never render as the agent's voice, and a rationale-only turn always reads as an answer.

**Architecture:** Three thin, layered changes: a `isWhyShaped` predicate gating `planTurnBlocks`' presentation (domain), one added alternative in the `TOOL_SYNTAX` lint regex (domain), and a vetted `rationale_intro` notice unshifted in `runTurn` when a rationale block has no surviving voice (server), with `rationale_intro` joining the copy catalog under COPY_VERSION '10'.

**Tech Stack:** TypeScript strict, vitest (+ `ai/test` MockLanguageModel stubs for the route tests).

**Spec:** `docs/superpowers/specs/2026-08-07-why-questions-answer-only-design.md`

## Global Constraints

- Why-shaped means exactly: trimmed, lowercased text that starts with `"why "` or contains `"why do you"`.
- Suppression applies ONLY to the model turn path with `doneWith === null`. Done turns, `presentPlan` (upload path), and the degraded fallback (`runTurnSafely` catch) keep presenting — they pass `null` as the applicant text.
- `rationale_intro` copy is exactly `"Here's why we ask:"` — interim wording joining the legal batch. COPY_VERSION becomes exactly `'10'`; the transcript shown-copy hash prefix becomes `v10|`.
- The `TOOL_SYNTAX` extension adds only the bracket-colon shape; no new violation code — it reports `tool_syntax`.
- The model never chooses grouping — no model-signaled presentation control.
- Code comments short and sparse. Test commands: `npx vitest run <path>`; typecheck `npx tsc --noEmit` — paste actual output of both in each task report.
- Commit after every task with the message the task gives.

## File Structure

- Modify `src/domain/orchestrator/plan.ts` — `isWhyShaped` export; `planTurnBlocks` gains required 4th param `applicantText: string | null`.
- Modify `src/domain/orchestrator/voice-lint.ts` — `TOOL_SYNTAX` bracket-colon alternative.
- Modify `src/domain/orchestrator/copy.ts` — `rationale_intro`, COPY_VERSION '10'.
- Modify `src/server/orchestrator/service.ts` — pass `request.userText` to the planner; unshift `rationale_intro` when a rationale block has no voice.
- Modify `src/server/application-service.ts` — the two `planTurnBlocks` call sites pass `null`.
- Tests: `tests/domain/orchestrator/plan.test.ts`, `tests/domain/orchestrator/voice-lint.test.ts`, `tests/domain/orchestrator/copy.test.ts`, `tests/domain/orchestrator/transcript.test.ts`, `tests/integration/turn-route.test.ts`.

---

### Task 1: `isWhyShaped` + planner suppression

**Files:**
- Modify: `src/domain/orchestrator/plan.ts:59-82`
- Test: `tests/domain/orchestrator/plan.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isWhyShaped(text: string): boolean`; `planTurnBlocks(state: ApplicationState, transcript: readonly Turn[], doneWith: Section | null, applicantText: string | null): Block[]` — the 4th parameter is REQUIRED (no default), so no call site can silently forget it. Tasks 4 updates the server call sites; until then `npx tsc --noEmit` will list them — expected mid-task, resolved in Task 4. The full-suite run in THIS task therefore comes after updating only the domain test call sites; the suite compiles because vitest transpiles per-file and the server call sites are exercised only by integration tests — if those fail to compile under vitest, add the 4th argument `null` to the two `src/server` call sites as part of this task's Step 3 (do it minimally: literal `null`, no other change) and say so in your report.

- [ ] **Step 1: Write the failing tests**

In `tests/domain/orchestrator/plan.test.ts`, add `isWhyShaped` to the existing `@/domain/orchestrator/plan` import, then add at the end of the file:

```ts
describe('isWhyShaped', () => {
  it('accepts the pill templates and typed variants', () => {
    expect(isWhyShaped('Why do you need my last name?')).toBe(true)
    expect(isWhyShaped('Why do you ask “Which ID will you use?”')).toBe(true)
    expect(isWhyShaped('  WHY is that required')).toBe(true)
    expect(isWhyShaped('tell me why do you need this')).toBe(true)
  })

  it('rejects non-why intents', () => {
    expect(isWhyShaped('What else do you need?')).toBe(false)
    expect(isWhyShaped("I'm ready")).toBe(false)
    expect(isWhyShaped('Tell me why later')).toBe(false)
  })
})

describe('planTurnBlocks and why-shaped turns', () => {
  it('presents nothing for a why-question on an empty transcript', () => {
    const state = fresh()
    expect(planTurnBlocks(state, [], null, 'Why do you ask “What best describes you?”'))
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
```

Existing `planTurnBlocks(...)` calls elsewhere in this test file get a 4th argument `null` (mechanical; find them with `grep -n "planTurnBlocks(" tests/domain/orchestrator/plan.test.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/orchestrator/plan.test.ts`
Expected: FAIL — `isWhyShaped` is not exported / arity errors.

- [ ] **Step 3: Implement**

In `src/domain/orchestrator/plan.ts`:

```ts
/** A question about a field, not a demand to fill the form. Closed heuristic
 *  — the model never chooses grouping, so neither does it choose this. */
export function isWhyShaped(text: string): boolean {
  const t = text.trim().toLowerCase()
  return t.startsWith('why ') || t.includes('why do you')
}
```

`planTurnBlocks` gains the required 4th parameter and one check between the `doneWith` branch and the newest-on-screen check:

```ts
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
```

Update the doc comment above the function (it currently describes only the Done/stay-put rules — add the why clause in one sentence).

If vitest fails to compile the integration tests because of the new arity, add `null` as the 4th argument at the two `src/server` call sites (`src/server/orchestrator/service.ts:80` → `request.userText` comes in Task 4, use `null` for now; `src/server/application-service.ts:75` and `:306` → `null`) — smallest change that compiles, flagged in your report.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/orchestrator/plan.test.ts`, then `npx vitest run`
Expected: PASS (full suite may need the call-site `null`s per Step 3's note).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output. If it lists the server call sites and Step 3's fallback was not needed for vitest, apply the same minimal `null` arguments now so the branch typechecks at every commit.

```bash
git add src/domain/orchestrator/plan.ts tests/domain/orchestrator/plan.test.ts src/server
git commit -m "feat(plan): why-shaped turns never trigger a section presentation"
```

---

### Task 2: Voice-lint catches bracket-colon tool narration

**Files:**
- Modify: `src/domain/orchestrator/voice-lint.ts:19-20`
- Test: `tests/domain/orchestrator/voice-lint.test.ts`

**Interfaces:**
- Consumes / Produces: `lintVoice` unchanged in signature; `[word: …` now yields `{ ok: false, violation: 'tool_syntax' }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/domain/orchestrator/voice-lint.test.ts` (match the file's existing describe/import style):

```ts
  it('drops a bracketed completed-tool marker as tool syntax', () => {
    expect(lintVoice('[explained: location_country]'))
      .toEqual({ ok: false, violation: 'tool_syntax' })
  })

  it('still drops bracketed call syntax', () => {
    expect(lintVoice('[askFor(field: last_name)]'))
      .toEqual({ ok: false, violation: 'tool_syntax' })
  })

  it('keeps ordinary bracketed prose without a marker shape', () => {
    expect(lintVoice('We ask [almost] nothing else.')).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/orchestrator/voice-lint.test.ts`
Expected: FAIL — the first new test gets `{ ok: true }`.

- [ ] **Step 3: Implement**

In `src/domain/orchestrator/voice-lint.ts`, replace the `TOOL_SYNTAX` regex (and extend its comment's first sentence to mention completed-tool markers):

```ts
/**
 * A model narrating its tools instead of calling them — observed as
 * `[askFor(field: …)]` or `[explained: location_country]` emitted as prose.
 * Bracketed call-or-marker syntax, or a tool's own name used as a call.
 * `explain`/`orient` are ordinary words, so those two only match with the
 * paren flush against the name.
 */
const TOOL_SYNTAX =
  /\[\s*\w+\s*[(:]|\b(?:askfor|setprofile|requestdocument)\s*\(|\b(?:explain|orient)\(/i
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/orchestrator/voice-lint.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/domain/orchestrator/voice-lint.ts tests/domain/orchestrator/voice-lint.test.ts
git commit -m "fix(voice-lint): bracketed completed-tool markers are tool syntax"
```

---

### Task 3: `rationale_intro` copy under COPY_VERSION '10'

**Files:**
- Modify: `src/domain/orchestrator/copy.ts`
- Test: `tests/domain/orchestrator/copy.test.ts`, `tests/domain/orchestrator/transcript.test.ts`

**Interfaces:**
- Produces: `vettedCopy('rationale_intro') === "Here's why we ask:"`; `COPY_VERSION === '10'` (Task 4 consumes the copy id).

- [ ] **Step 1: Write the failing test**

In `tests/domain/orchestrator/copy.test.ts`, edit the version test (currently `'carries the start-screen copy, dash-free, under version 9'`): drop its `COPY_VERSION` assertion line, rename it to `'carries the start-screen copy, dash-free'`, and add:

```ts
  it('carries the rationale intro under version 10', () => {
    expect(COPY_VERSION).toBe('10')
    expect(vettedCopy('rationale_intro')).toBe("Here's why we ask:")
  })
```

In `tests/domain/orchestrator/transcript.test.ts`, update the hash-material expectation from `'v9|section:address:Address:1/4'` to `'v10|section:address:Address:1/4'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/orchestrator/copy.test.ts tests/domain/orchestrator/transcript.test.ts`
Expected: FAIL — unknown id / version '9'.

- [ ] **Step 3: Implement**

In `src/domain/orchestrator/copy.ts`: `COPY_VERSION = '10'`; add `'rationale_intro',` to `ALL_COPY_IDS` (after `'guard_fallback'`); add to `COPY` (after `guard_fallback`):

```ts
  rationale_intro: "Here's why we ask:",
```

- [ ] **Step 4: Run the focused tests, then the whole suite**

Run: `npx vitest run tests/domain/orchestrator/copy.test.ts tests/domain/orchestrator/transcript.test.ts && npx vitest run`
Expected: PASS. If anything else hardcodes `'9'`/`v9|`, fix it (find with `grep -rn "'9'\|v9|" tests/`).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/domain/orchestrator/copy.ts tests/domain/orchestrator/copy.test.ts tests/domain/orchestrator/transcript.test.ts
git commit -m "feat(copy): rationale_intro framing line, COPY_VERSION 10"
```

---

### Task 4: Server wiring + integration tests

**Files:**
- Modify: `src/server/orchestrator/service.ts:80-92`
- Modify: `src/server/application-service.ts:75,306`
- Test: `tests/integration/turn-route.test.ts`

**Interfaces:**
- Consumes: `planTurnBlocks(state, transcript, doneWith, applicantText)` (Task 1), `rationale_intro` (Task 3), lint extension (Task 2).
- Produces: final behavior; no new exports.

- [ ] **Step 1: Write the failing tests**

Add to `tests/integration/turn-route.test.ts`, using the file's existing helpers (`seed`, `post`, `useModel`, `stubModel`, `throwingModel`):

```ts
describe('why-shaped turns', () => {
  it('answers a first-turn why-question without presenting the section', async () => {
    seed()
    useModel(stubModel('Because it shapes what we ask next.', [
      { toolName: 'explain', input: { fieldId: 'primary_activity' } },
    ]))

    const response = await post('app-1', { text: 'Why do you ask “What best describes you?”' })
    expect(response.status).toBe(200)
    const { turn } = await response.json()

    expect(turn.voice).toBe('Because it shapes what we ask next.')
    expect(turn.blocks.some((b: { kind: string }) => b.kind === 'rationale')).toBe(true)
    expect(turn.blocks.some((b: { kind: string }) => b.kind === 'section_header')).toBe(false)
  })

  it('still presents the section for a first-turn "what else" question', async () => {
    seed()
    useModel(stubModel('Plenty — here it is.', []))

    const response = await post('app-1', { text: 'What else do you need?' })
    const { turn } = await response.json()

    expect(turn.blocks.some((b: { kind: string }) => b.kind === 'section_header')).toBe(true)
  })

  it('the degraded fallback still presents even for a why-question', async () => {
    seed()
    __setModelForTurnTests(() => ({ model: throwingModel(), effort: 'low', isAnthropic: false }))

    const response = await post('app-1', { text: 'Why do you need my address?' })
    const { turn } = await response.json()

    expect(turn.blocks[0]).toMatchObject({ kind: 'notice', copyId: 'degraded_notice' })
    expect(turn.blocks.some((b: { kind: string }) => b.kind === 'section_header')).toBe(true)
  })

  it('a narrated tool marker never renders: voice dropped, guard fallback stands in', async () => {
    seed()
    useModel(stubModel('[explained: location_country]', []))

    const response = await post('app-1', { text: 'Why do you ask “Where are you located?”' })
    const { turn } = await response.json()

    expect(turn.voice).toBeNull()
    expect(turn.blocks).toEqual([{ kind: 'notice', copyId: 'guard_fallback' }])
  })

  it('frames a rationale-only turn with the vetted intro when the voice dies', async () => {
    seed()
    useModel(stubModel('[explained: primary_activity]', [
      { toolName: 'explain', input: { fieldId: 'primary_activity' } },
    ]))

    const response = await post('app-1', { text: 'Why do you ask “Where are you located?”' })
    const { turn } = await response.json()

    expect(turn.voice).toBeNull()
    expect(turn.blocks[0]).toMatchObject({ kind: 'notice', copyId: 'rationale_intro' })
    expect(turn.blocks[1]).toMatchObject({ kind: 'rationale', fieldId: 'primary_activity' })
  })
})
```

- [ ] **Step 2: Run test to verify the new ones fail**

Run: `npx vitest run tests/integration/turn-route.test.ts`
Expected: the first test FAILS (a `section_header` is present); the marker test FAILS (voice renders or section presents). The degraded and "what else" tests may already pass — confirm each new test's status and note it.

- [ ] **Step 3: Implement**

In `src/server/orchestrator/service.ts`:

1. Line 80 becomes:

```ts
  blocks.push(...planTurnBlocks(planState, request.transcript, request.doneWith, request.userText))
```

Note: on Done turns `request.userText` is the vetted done chip (`applicantText` at `application-service.ts:184`) — not why-shaped, and the `doneWith` branch returns first anyway.

2. After `const voice = decideVoice(result.text, blocks)` and before the existing guard-fallback block, add:

```ts
  // A rationale with no surviving voice reads as bare catalog copy; the
  // vetted intro makes it an answer.
  if (voice.text === null && blocks.some((b) => b.kind === 'rationale')) {
    blocks.unshift({ kind: 'notice', copyId: 'rationale_intro' })
  }
```

(The guard-fallback `blocks.length === 0` condition is untouched and now unreachable when a rationale exists — correct.)

In `src/server/application-service.ts`: both call sites pass `null` as the 4th argument (kept from Task 1's compile fix if it was applied there):

- `:75` → `planTurnBlocks(current, current.transcript, null, null)`
- `:306` → `...planTurnBlocks(rest.state, rest.transcript, rest.doneWith, null),`

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/integration/turn-route.test.ts`, then `npx vitest run`
Expected: PASS — all, including the pre-existing turn-route tests (several use `defaultModel` which calls `explain` with a real voice; their blocks change only if they asserted the exact block list of a first-turn presentation — if one did, update it to reflect that a non-why first turn still presents, preserving the test's intent, and flag it in your report).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/server/orchestrator/service.ts src/server/application-service.ts tests/integration/turn-route.test.ts
git commit -m "feat(orchestrator): answer-only why turns, vetted rationale framing"
```

---

### Task 5: Full verification + Chrome walk

**Files:** none new — verification only. Fix anything found and commit fixes.

- [ ] **Step 1: Full suite and typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`. Paste both outputs; both must be clean.

- [ ] **Step 2: Chrome walk**

Start the dev server (log to a file; model turns can take 30–90s — wait on the log's POST lines). On a fresh application:

1. Click "Why do you ask “What best describes you?”" → the reply is an answer (model voice, and/or the vetted "Here's why we ask:" + rationale) with NO section dump and NO "Done with this section" bar beneath it.
2. Click "What else do you need?" (fresh application) → the section presents as before.
3. Send a plain "hello" (fresh application) → section presents; then ask a why-question mid-section → answer only, screen stays put.
4. Confirm no raw `[…]` marker ever renders, and the console stays clean.

- [ ] **Step 3: Close out**

Fix any defects found (with tests where test-shaped), commit, re-run the suite, and report the final counts with the walk's observations.
