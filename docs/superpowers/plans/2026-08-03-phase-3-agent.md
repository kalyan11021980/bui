# Phase 3 — Conversational Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An applicant is met by an agent that introduces itself, establishes their profile in conversation, and asks for what the requirements engine says is outstanding — while every legally operative word comes from the catalog and no field value ever enters a model context.

**Architecture:** The LLM sits beside the state machine, never inside it. A redaction boundary turns `ApplicationState` into an `OrchestratorView` carrying identifiers, statuses and confidence but not values. The model gets five tools and no `execute` function; a pure guard maps each returned call to an `Action` or a typed rejection. Model-generated "voice" is buffered server-side, linted, and dropped on violation — vetted catalog copy renders regardless.

**Tech Stack:** TypeScript, Next.js 15, React 19, Zod 3, Vitest 2, Vercel AI SDK 7 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`).

**Spec:** `docs/superpowers/specs/2026-08-03-phase-3-agent-design.md`

## Global Constraints

- **`src/domain/` purity is enforced by `tests/domain/purity.test.ts`.** No domain file may import `ai`, `@ai-sdk/*`, `next`, `@/server`, `@/ui`, `@/app`; may read `process.env`; may call `Date.now()`, `new Date()`, `Math.random()`, `randomUUID()`; or perform fs/network I/O. Timestamps and secrets are passed in.
- **No hardcoded host, port, or model id anywhere.** All of it via env: `ORCHESTRATOR_PROVIDER`, `ORCHESTRATOR_ENDPOINT`, `ORCHESTRATOR_MODEL`, `ORCHESTRATOR_EFFORT`, `ANTHROPIC_API_KEY`.
- **No test may require a reachable model.** Every test supplies a stub provider. The suite must pass with no network.
- **Audit fails closed.** An unresolvable field id throws rather than defaulting to not-sensitive.
- **Every test that claims to catch a regression ships a sabotage check that fails loudly with a read-back.** Ten of fifteen Phase 2 briefs shipped a test that could not fail; every one was caught by a person, never by the suite. Before writing code for a task, audit the test given to you in that task: confirm it fails for the stated reason, not for a missing import or a thrown constructor.
- **A red run is not proof anything was asserted.** Three failure modes seen in Phase 2: a mutation that silently did not apply, a failure that was only the runner's unhandled-error report, and a throw that pre-empted the assertions. When a step says "verify it fails", read the failure message and confirm it names the assertion.
- Commands: `npx vitest run <path>` for one file, `npm test` for all, `npm run typecheck`, `npm run build`.
- Tests mirror `src/` under `tests/`. Never colocated.
- Comments are short and sparse. State constraints the code cannot show; never narrate what the next line does.

---

## File Structure

**Created — domain (pure):**

| File | Responsibility |
|---|---|
| `src/domain/orchestrator/copy.ts` | `VettedCopyId`, the fixed strings, `COPY_VERSION` |
| `src/domain/orchestrator/voice-lint.ts` | §7 rule 3. Pure predicate over a string |
| `src/domain/orchestrator/view.ts` | `ApplicationState` → `OrchestratorView`. The redaction boundary |
| `src/domain/orchestrator/transcript.ts` | `Turn`, `Block` types |
| `src/domain/orchestrator/tools.ts` | The five tool names and their **Zod input schemas**. No `ai` import |
| `src/domain/orchestrator/guard.ts` | Tool call → `Action` or typed rejection |

**Created — server:**

| File | Responsibility |
|---|---|
| `src/server/orchestrator/model.ts` | env → `LanguageModel`. The only file naming a provider |
| `src/server/orchestrator/tool-set.ts` | Domain Zod schemas → AI SDK `ToolSet`. No `execute` |
| `src/server/orchestrator/prompt.ts` | System prompt + `messages` from the transcript |
| `src/server/orchestrator/service.ts` | `runTurn()`: view + intent → `Turn` |
| `src/app/api/application/[id]/turn/route.ts` | The turn endpoint |

**Created — UI:** `src/ui/chat/ConversationShell.tsx`, `TurnView.tsx`, `blocks.tsx`, `src/ui/client/useConversation.ts`

**Modified:** `src/domain/application/state.ts` (`APPEND_TURN`, `transcript`, `orchestratorRejections`), `src/domain/application/reducer.ts`, `src/domain/application/action-schema.ts`, `src/domain/audit/event.ts`, `src/domain/audit/log.ts`, `src/domain/field-def.ts` (`neverBulkConfirm`), `src/domain/catalog/{address,identity,tax}.ts`, `src/app/page.tsx`, `package.json`

**Deleted:** `src/ui/demo/ProfileControls.tsx`

**Deviation from the spec, deliberate:** the spec places `guard.ts` under `src/server/orchestrator/`. It is a pure function of `(toolCall, ApplicationState)` with no I/O, so it belongs in `src/domain/orchestrator/` where the purity test covers it. Everything else matches the spec's §3 layout.

---

### Task 1: Dependencies and the model adapter

**Files:**
- Modify: `package.json`
- Create: `src/server/orchestrator/model.ts`
- Test: `tests/server/orchestrator/model.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveModel(env: NodeJS.ProcessEnv): LanguageModel` and `type OrchestratorConfig = { provider: 'local' | 'anthropic'; modelId: string; effort: string; endpoint?: string; apiKey?: string }` — `effort` is required and defaults to `'low'` — plus `readConfig(env: NodeJS.ProcessEnv): OrchestratorConfig`, which throws on invalid config.

- [ ] **Step 1: Install the packages**

```bash
npm install ai@^7 @ai-sdk/anthropic@^4 @ai-sdk/openai-compatible@^3
```

- [ ] **Step 2: Write the failing test**

Create `tests/server/orchestrator/model.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readConfig } from '@/server/orchestrator/model'

const base = { ORCHESTRATOR_MODEL: 'some-model', ORCHESTRATOR_ENDPOINT: 'http://host:1234' }

describe('readConfig', () => {
  it('defaults to the local provider', () => {
    expect(readConfig({ ...base }).provider).toBe('local')
  })

  it('requires an endpoint for the local provider', () => {
    expect(() => readConfig({ ORCHESTRATOR_MODEL: 'm' }))
      .toThrow(/ORCHESTRATOR_ENDPOINT/)
  })

  it('requires a model id whatever the provider', () => {
    expect(() => readConfig({ ORCHESTRATOR_ENDPOINT: 'http://h:1' }))
      .toThrow(/ORCHESTRATOR_MODEL/)
  })

  it('requires an api key for the anthropic provider', () => {
    expect(() => readConfig({ ...base, ORCHESTRATOR_PROVIDER: 'anthropic' }))
      .toThrow(/ANTHROPIC_API_KEY/)
  })

  it('rejects an unrecognised provider rather than falling back to local', () => {
    expect(() => readConfig({ ...base, ORCHESTRATOR_PROVIDER: 'openai' }))
      .toThrow(/openai/)
  })

  it('carries effort through, defaulting to low', () => {
    expect(readConfig({ ...base }).effort).toBe('low')
    expect(readConfig({ ...base, ORCHESTRATOR_EFFORT: 'high' }).effort).toBe('high')
  })
})
```

- [ ] **Step 3: Run it and confirm it fails for the right reason**

Run: `npx vitest run tests/server/orchestrator/model.test.ts`
Expected: FAIL — cannot resolve `@/server/orchestrator/model`. If it fails for any other reason, stop and read the message.

- [ ] **Step 4: Implement**

Create `src/server/orchestrator/model.ts`:

```ts
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export type OrchestratorConfig = {
  provider: 'local' | 'anthropic'
  modelId: string
  endpoint?: string
  /** Ignored by the local provider: an OpenAI-compatible endpoint has no equivalent. */
  effort: string
  apiKey?: string
}

const PROVIDERS = new Set(['local', 'anthropic'])

export function readConfig(env: NodeJS.ProcessEnv): OrchestratorConfig {
  const provider = env.ORCHESTRATOR_PROVIDER ?? 'local'
  if (!PROVIDERS.has(provider)) {
    throw new Error(
      `ORCHESTRATOR_PROVIDER must be "local" or "anthropic", got "${provider}"`,
    )
  }

  const modelId = env.ORCHESTRATOR_MODEL
  if (!modelId) throw new Error('ORCHESTRATOR_MODEL must be set')

  const effort = env.ORCHESTRATOR_EFFORT ?? 'low'

  if (provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set when ORCHESTRATOR_PROVIDER=anthropic')
    return { provider, modelId, effort, apiKey }
  }

  const endpoint = env.ORCHESTRATOR_ENDPOINT
  if (!endpoint) throw new Error('ORCHESTRATOR_ENDPOINT must be set when ORCHESTRATOR_PROVIDER=local')
  return { provider, modelId, effort, endpoint }
}

export function resolveModel(env: NodeJS.ProcessEnv): LanguageModel {
  const config = readConfig(env)
  if (config.provider === 'anthropic') {
    return createAnthropic({ apiKey: config.apiKey })(config.modelId)
  }
  return createOpenAICompatible({
    name: 'orchestrator-local',
    baseURL: `${config.endpoint}/v1`,
  })(config.modelId)
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run tests/server/orchestrator/model.test.ts` → PASS (6 tests)

- [ ] **Step 6: Sabotage check**

Change `PROVIDERS` to accept anything (`const PROVIDERS = new Set(['local', 'anthropic', 'openai'])`). Run the test. Confirm **"rejects an unrecognised provider"** goes red and the message names `openai`. Revert.

- [ ] **Step 7: Confirm the purity test still passes**

Run: `npx vitest run tests/domain/purity.test.ts` → PASS. `ai` must not have leaked into `src/domain/`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/server/orchestrator/model.ts tests/server/orchestrator/model.test.ts
git commit -m "feat(orchestrator): select the model from the environment"
```

---

### Task 2: The voice lint

**Files:**
- Create: `src/domain/orchestrator/voice-lint.ts`
- Test: `tests/domain/orchestrator/voice-lint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type VoiceViolation = 'numeral' | 'percentage' | 'statute' | 'legal_claim' | 'length'` and `lintVoice(text: string): { ok: true } | { ok: false; violation: VoiceViolation }`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/orchestrator/voice-lint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lintVoice } from '@/domain/orchestrator/voice-lint'

const PASSING = [
  'Thanks — let me get a couple of details from you.',
  'Sure, here is exactly why we ask:',
  'Nearly there. Just a few more.',
]

const FAILING: ReadonlyArray<[string, string]> = [
  ['You have 3 things left.', 'numeral'],
  ['Almost ninety percent done.', 'percentage'],
  ['This is 90% done.', 'percentage'],
  ['Required under 26 U.S.C. for reporting.', 'statute'],
  ['See § 1234 for details.', 'statute'],
  ['Refer to the CFR for this one.', 'statute'],
  ['You must provide this.', 'legal_claim'],
  ['This is required by law.', 'legal_claim'],
  ['You are liable for errors here.', 'legal_claim'],
  ['x'.repeat(241), 'length'],
]

describe('lintVoice', () => {
  it.each(PASSING)('accepts ordinary conversational voice: %s', (text) => {
    expect(lintVoice(text)).toEqual({ ok: true })
  })

  it.each(FAILING)('rejects %s as %s', (text, violation) => {
    const result = lintVoice(text)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.violation).toBe(violation)
  })

  it('accepts a string at the length limit and rejects one past it', () => {
    expect(lintVoice('a'.repeat(240))).toEqual({ ok: true })
    expect(lintVoice('a'.repeat(241)).ok).toBe(false)
  })

  it('rejects non-ASCII digits, not just 0-9', () => {
    expect(lintVoice('You have ٣ left.').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `npx vitest run tests/domain/orchestrator/voice-lint.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement**

Create `src/domain/orchestrator/voice-lint.ts`:

```ts
export type VoiceViolation =
  | 'numeral' | 'percentage' | 'statute' | 'legal_claim' | 'length'

export type VoiceLintResult =
  | { ok: true }
  | { ok: false; violation: VoiceViolation }

const MAX_LENGTH = 240

/** Any Unicode decimal digit — a numeral in another script is still a numeral. */
const NUMERAL = /\p{Nd}/u
const PERCENTAGE = /%|\bpercent\b|\bper cent\b/i
const STATUTE = /§|\bU\.?S\.?C\.?\b|\bC\.?F\.?R\.?\b|\bIRC\b|\bTitle\s+\p{Nd}/iu

/**
 * Phrasings that assert an obligation. Not a general classifier — a closed
 * list is auditable and a model is not.
 */
const LEGAL_CLAIM = [
  /\brequired by law\b/i,
  /\byou must\b/i,
  /\byou are (?:liable|obligated|responsible under)\b/i,
  /\bpenalt(?:y|ies)\b/i,
  /\bunder oath\b/i,
  /\bwe are required to\b/i,
]

/**
 * Most specific first. A statute reference and a percentage both contain
 * digits, so a numeral-first order could never report either — and the
 * narrower diagnosis is the useful one when tuning the rules against real
 * output.
 */
export function lintVoice(text: string): VoiceLintResult {
  if (text.length > MAX_LENGTH) return { ok: false, violation: 'length' }
  if (STATUTE.test(text)) return { ok: false, violation: 'statute' }
  if (PERCENTAGE.test(text)) return { ok: false, violation: 'percentage' }
  if (NUMERAL.test(text)) return { ok: false, violation: 'numeral' }
  for (const pattern of LEGAL_CLAIM) {
    if (pattern.test(text)) return { ok: false, violation: 'legal_claim' }
  }
  return { ok: true }
}
```

The order is load-bearing and the test data encodes it: `'See § 1234 for details.'` and `'Required under 26 U.S.C. for reporting.'` both contain digits but report `statute`; `'This is 90% done.'` reports `percentage`; `'You have 3 things left.'` reaches `numeral` because nothing narrower matches. Every one of these still rejects — only the label differs.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/domain/orchestrator/voice-lint.test.ts` → PASS

- [ ] **Step 5: Sabotage each rule independently**

For each of the five rules in turn: comment out its check, run the test, confirm **only** the cases for that rule go red and the failure names the expected violation. Restore before moving to the next. A rule whose removal turns nothing red is a rule with no test.

- [ ] **Step 6: Commit**

```bash
git add src/domain/orchestrator/voice-lint.ts tests/domain/orchestrator/voice-lint.test.ts
git commit -m "feat(orchestrator): lint model voice for numerals, statutes and legal claims"
```

---

### Task 3: The vetted copy registry

**Files:**
- Create: `src/domain/orchestrator/copy.ts`
- Test: `tests/domain/orchestrator/copy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type VettedCopyId`, `COPY: Readonly<Record<VettedCopyId, string>>`, `COPY_VERSION: string`, `vettedCopy(id: VettedCopyId): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/orchestrator/copy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { COPY, COPY_VERSION, vettedCopy, ALL_COPY_IDS } from '@/domain/orchestrator/copy'

describe('vetted copy', () => {
  it('has a non-empty string for every declared id', () => {
    expect(ALL_COPY_IDS.length).toBeGreaterThan(3)
    for (const id of ALL_COPY_IDS) {
      expect(vettedCopy(id).trim(), id).not.toBe('')
    }
  })

  it('throws on an unknown id rather than returning a blank', () => {
    // @ts-expect-error deliberately outside the union
    expect(() => vettedCopy('no_such_copy')).toThrow(/no_such_copy/)
  })

  it('carries the opening beat verbatim from the spec', () => {
    const beat = vettedCopy('opening_beat')
    expect(beat).toContain("I'm your registration agent")
    expect(beat).toContain('about four minutes')
    expect(beat).toContain('state law requires a human to verify dealer licenses')
  })

  it('declares a version so a copy change is detectable', () => {
    expect(COPY_VERSION).toMatch(/^\d+$/)
  })

  it('exposes COPY as the same data vettedCopy reads', () => {
    for (const id of ALL_COPY_IDS) expect(COPY[id]).toBe(vettedCopy(id))
  })
})
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `npx vitest run tests/domain/orchestrator/copy.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/domain/orchestrator/copy.ts`:

```ts
/**
 * Every fixed string the agent can cause to appear. Model output never lands
 * here — the transcript stores these ids, and the string is resolved at render
 * time so a copy revision cannot silently rewrite history.
 *
 * Bump COPY_VERSION on any edit: it is an input to the shown-copy hash, which
 * is what lets an attestation be reconstructed after a change.
 */
export const COPY_VERSION = '1'

export const ALL_COPY_IDS = [
  'opening_beat',
  'guard_fallback',
  'degraded_notice',
  'panel_only_notice',
  'address_still_current',
] as const

export type VettedCopyId = (typeof ALL_COPY_IDS)[number]

export const COPY: Readonly<Record<VettedCopyId, string>> = Object.freeze({
  opening_beat: [
    "Hi — I'm your registration agent. I'll get you set up to bid at IAA.",
    "Here's how this works. I'll ask you a few things, and wherever I can I'll fill them in myself from your documents so you don't have to type. I'll always tell you why I need something.",
    'It takes about four minutes. After that, a person on our Buyer Services team checks your documents — usually within 24 hours — because state law requires a human to verify dealer licenses.',
    'Ready? The fastest start is your driver\'s license. One photo fills in about eight things.',
  ].join('\n\n'),

  guard_fallback: "Let's keep going with what's left.",

  degraded_notice:
    "I can't reach my assistant right now. Nothing is lost — you can carry on filling this in directly, and every question still explains why it's asked.",

  panel_only_notice:
    "I'll step back and let you fill this in directly. Everything you've entered is saved, and each question still explains why it's asked.",

  address_still_current:
    'Is this still the address you want on file?',
})

export function vettedCopy(id: VettedCopyId): string {
  const text = COPY[id]
  if (text === undefined) throw new Error(`Unknown vetted copy id: ${String(id)}`)
  return text
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/domain/orchestrator/copy.test.ts` → PASS

- [ ] **Step 5: Sabotage check**

Set `guard_fallback` to `''`. Run. Confirm **"has a non-empty string for every declared id"** goes red and names `guard_fallback`. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/domain/orchestrator/copy.ts tests/domain/orchestrator/copy.test.ts
git commit -m "feat(orchestrator): register the vetted strings the agent can show"
```

---

### Task 4: The redaction boundary

**Files:**
- Create: `src/domain/orchestrator/view.ts`
- Test: `tests/domain/orchestrator/view.test.ts`

**Interfaces:**
- Consumes: `ApplicationState`, `FieldStatus`, `ProvenanceSource` from `@/domain/application/state`; `outstandingFields` from `@/domain/application/queries`; `fieldDef` from `@/domain/catalog`; `parseReqKey` from `@/domain/requirements/key`; `documentsToUpload` from `@/domain/requirements/documents`.
- Produces: `type FieldView`, `type OrchestratorView`, `toOrchestratorView(state: ApplicationState, uploadedDocs: readonly DocType[]): OrchestratorView`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/orchestrator/view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toOrchestratorView } from '@/domain/orchestrator/view'
import { createApplication } from '@/domain/application/reducer'
import { applicationReducer } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'

function seeded(): ApplicationState {
  const base = createApplication('app-1', {
    applicantType: 'individual', country: 'US', state: 'GA',
    wantsGsa: false, licenses: [], addressDiffersFromId: false,
    idForm: 'drivers_license',
  }, 'tok')
  return applicationReducer(base, {
    type: 'SET_VALUE', fieldId: 'tax_id', value: '123456789',
    source: 'user', at: '2026-08-03T00:00:00.000Z',
  })
}

describe('toOrchestratorView', () => {
  it('never carries a sensitive field value', () => {
    const view = toOrchestratorView(seeded(), [])
    const serialised = JSON.stringify(view)
    expect(serialised).not.toContain('123456789')
  })

  it('carries the field id, label and status for a sensitive field', () => {
    const view = toOrchestratorView(seeded(), [])
    const all = [...view.outstanding, ...view.settled]
    const taxId = all.find((f) => f.id === 'tax_id')
    expect(taxId).toBeDefined()
    expect(taxId?.sensitive).toBe(true)
    expect(taxId?.status).toBe('confirmed')
    expect(taxId?.value).toBeUndefined()
  })

  it('carries the value only for an orchestratorVisible field', () => {
    // first_name is the allowlisted display value; see the catalog.
    const state = applicationReducer(seeded(), {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: '2026-08-03T00:00:00.000Z',
    })
    const view = toOrchestratorView(state, [])
    const all = [...view.outstanding, ...view.settled]
    expect(all.find((f) => f.id === 'first_name')?.value).toBe('Kalyan')
  })

  it('splits outstanding from settled by the same rule the panel uses', () => {
    const view = toOrchestratorView(seeded(), [])
    expect(view.outstanding.every((f) => f.status !== 'confirmed')).toBe(true)
    expect(view.settled.some((f) => f.id === 'tax_id')).toBe(true)
  })

  it('omits documents already uploaded', () => {
    const view = toOrchestratorView(seeded(), ['drivers_license'])
    expect(view.documentsOutstanding).not.toContain('drivers_license')
  })

  it('throws on a stored field with no catalog entry rather than assuming it is safe', () => {
    const broken = seeded()
    const rogue = { ...broken, fields: { ...broken.fields, not_a_field: { value: 'x', status: 'confirmed' as const } } }
    expect(() => toOrchestratorView(rogue, [])).toThrow(/not_a_field/)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `npx vitest run tests/domain/orchestrator/view.test.ts` → FAIL, module not found.

Before implementing, confirm `first_name` actually carries `orchestratorVisible: true` in `src/domain/catalog/identity.ts`. If it does not, add it there in this task (it is non-sensitive and is the value §8.1 of the spec names as the warmth case), and confirm `tests/domain/field-def.test.ts` still passes.

- [ ] **Step 3: Implement**

Create `src/domain/orchestrator/view.ts`:

```ts
import { outstandingFields } from '../application/queries'
import type { ApplicationState, FieldStatus, ProvenanceSource } from '../application/state'
import { fieldDef } from '../catalog'
import type { DocType } from '../field-id'
import { documentsToUpload } from '../requirements/documents'
import { parseReqKey } from '../requirements/key'
import type { RequirementKey } from '../requirements/key'
import type { ApplicantProfile } from '../requirements/rules'

export type FieldView = {
  id: RequirementKey
  label: string
  status: FieldStatus
  sensitive: boolean
  source?: ProvenanceSource
  confidence?: number
  /** Only when the catalog allowlists it. See orchestratorVisible. */
  value?: string
}

export type OrchestratorView = {
  applicationId: string
  profile: ApplicantProfile
  outstanding: readonly FieldView[]
  settled: readonly FieldView[]
  documentsOutstanding: readonly DocType[]
  submitted: boolean
  rulesVersion: number
}

/**
 * The only function on the model path that reads ApplicationState. Everything
 * downstream takes an OrchestratorView, so leaking a value takes an edit here
 * rather than a forgotten redaction at a call site.
 */
export function toOrchestratorView(
  state: ApplicationState,
  uploadedDocs: readonly DocType[],
): OrchestratorView {
  const outstandingKeys = new Set(outstandingFields(state))
  const outstanding: FieldView[] = []
  const settled: FieldView[] = []

  for (const key of Object.keys(state.fields)) {
    const field = state.fields[key]
    if (!field) continue
    const view = viewOf(key, field.status, field.provenance, field.value)
    ;(outstandingKeys.has(key) ? outstanding : settled).push(view)
  }

  for (const key of outstandingKeys) {
    if (state.fields[key]) continue
    outstanding.push(viewOf(key, 'empty', undefined, null))
  }

  const held = new Set(uploadedDocs)
  return {
    applicationId: state.id,
    profile: state.profile,
    outstanding,
    settled,
    documentsOutstanding: documentsToUpload(state.profile).filter((d) => !held.has(d)),
    submitted: state.submittedAt !== null,
    rulesVersion: state.rulesVersion,
  }
}

function viewOf(
  key: RequirementKey,
  status: FieldStatus,
  provenance: { source: ProvenanceSource; confidence?: number } | undefined,
  value: unknown,
): FieldView {
  // Fails closed, like AuditLog.append: not knowing whether a field is
  // sensitive is a reason to refuse, never to assume it is not.
  const def = fieldDef(parseReqKey(key).fieldId)
  const visible = def.sensitive !== true
    && (def as { orchestratorVisible?: boolean }).orchestratorVisible === true

  return {
    id: key,
    label: def.label,
    status,
    sensitive: def.sensitive === true,
    ...(provenance?.source !== undefined && { source: provenance.source }),
    ...(provenance?.confidence !== undefined && { confidence: provenance.confidence }),
    ...(visible && value !== null && value !== undefined && { value: String(value) }),
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/domain/orchestrator/view.test.ts` → PASS (6 tests)

- [ ] **Step 5: Sabotage check — this is the one that matters**

Change `visible` to `const visible = def.sensitive !== true` (dropping the allowlist requirement). Run. Confirm **"never carries a sensitive field value"** stays green (tax_id is still sensitive) but that a second sabotage — `const visible = true` — turns it red naming `123456789`. Both mutations must be observed to go red on the assertion that covers them; if neither does, the test cannot fail and must be fixed before proceeding. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/domain/orchestrator/view.ts tests/domain/orchestrator/view.test.ts src/domain/catalog/identity.ts
git commit -m "feat(orchestrator): carry identifiers to the model, never values"
```

---

### Task 5: Transcript on the record

**Files:**
- Create: `src/domain/orchestrator/transcript.ts`
- Modify: `src/domain/application/state.ts`, `src/domain/application/reducer.ts`, `src/domain/application/action-schema.ts`
- Test: `tests/domain/orchestrator/transcript.test.ts`, and extend `tests/domain/application/action-schema.test.ts`

**Interfaces:**
- Consumes: `VettedCopyId` from `@/domain/orchestrator/copy`; `RequirementKey`; `DocType`.
- Produces: `type Block`, `type Turn`; `ApplicationState.transcript: readonly Turn[]`; `ApplicationState.orchestratorRejections: number`; `Action` variant `{ type: 'APPEND_TURN'; turn: Turn; at: string }` and `{ type: 'RECORD_REJECTION'; at: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/orchestrator/transcript.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { Turn } from '@/domain/orchestrator/transcript'

const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}

function turn(seq: number): Turn {
  return {
    seq, at: '2026-08-03T00:00:00.000Z', role: 'agent',
    voice: 'Right — a couple more.',
    blocks: [{ kind: 'field_ask', fieldId: 'first_name' }],
  }
}

function fresh(): ApplicationState {
  return createApplication('app-1', PROFILE, 'tok')
}

describe('transcript on the application record', () => {
  it('starts empty with no rejections', () => {
    const state = fresh()
    expect(state.transcript).toEqual([])
    expect(state.orchestratorRejections).toBe(0)
  })

  it('appends turns in order', () => {
    let state = fresh()
    state = applicationReducer(state, { type: 'APPEND_TURN', turn: turn(1), at: turn(1).at })
    state = applicationReducer(state, { type: 'APPEND_TURN', turn: turn(2), at: turn(2).at })
    expect(state.transcript.map((t) => t.seq)).toEqual([1, 2])
  })

  it('refuses a turn whose seq is not the next one', () => {
    const state = applicationReducer(fresh(), {
      type: 'APPEND_TURN', turn: turn(1), at: turn(1).at,
    })
    expect(() => applicationReducer(state, {
      type: 'APPEND_TURN', turn: turn(3), at: turn(3).at,
    })).toThrow(/seq/)
  })

  it('counts rejections on the record so a reload cannot reset them', () => {
    let state = fresh()
    state = applicationReducer(state, { type: 'RECORD_REJECTION', at: turn(1).at })
    state = applicationReducer(state, { type: 'RECORD_REJECTION', at: turn(1).at })
    expect(state.orchestratorRejections).toBe(2)
  })

  it('refuses APPEND_TURN once submitted, like every other action', () => {
    const submitted = { ...fresh(), submittedAt: '2026-08-03T01:00:00.000Z' }
    expect(() => applicationReducer(submitted, {
      type: 'APPEND_TURN', turn: turn(1), at: turn(1).at,
    })).toThrow()
  })
})
```

- [ ] **Step 2: Run and confirm it fails for the right reason**

Run: `npx vitest run tests/domain/orchestrator/transcript.test.ts` → FAIL, `transcript` module missing.

- [ ] **Step 3: Create the types**

Create `src/domain/orchestrator/transcript.ts`:

```ts
import type { VettedCopyId } from './copy'
import type { DocType } from '../field-id'
import type { RequirementKey } from '../requirements/key'

/**
 * Blocks carry identifiers, not copy. The string is resolved from the catalog
 * at render time, so a copy revision cannot silently rewrite what the
 * transcript says was shown — that is what the shown-copy hash is for.
 */
export type Block =
  | { kind: 'field_ask'; fieldId: RequirementKey }
  | { kind: 'rationale'; fieldId: RequirementKey }
  | { kind: 'document_request'; docType: DocType }
  | { kind: 'orientation'; done: number; total: number }
  | { kind: 'notice'; copyId: VettedCopyId }

export type Turn = {
  /** 1-based within the application, like AuditEvent.seq. */
  seq: number
  at: string
  role: 'agent' | 'applicant'
  /** Linted model output, or null when dropped or when role is applicant. */
  voice: string | null
  voiceDropped?: 'lint' | 'sensitive'
  blocks: readonly Block[]
  /** Applicant turns only. Intent, never data. */
  text?: string
}
```

- [ ] **Step 4: Extend the state and reducer**

In `src/domain/application/state.ts`, add to `ApplicationState`:

```ts
  /** Agent and applicant turns, in order. Empty until phase 3 writes one. */
  transcript: readonly Turn[]
  /** Guard rejections on this application. Three drops it to panel-only. */
  orchestratorRejections: number
```

and to the `Action` union:

```ts
  | { type: 'APPEND_TURN'; turn: Turn; at: string }
  | { type: 'RECORD_REJECTION'; at: string }
```

with `import type { Turn } from '../orchestrator/transcript'` at the top.

In `src/domain/application/reducer.ts`, initialise both in `createApplication` (`transcript: []`, `orchestratorRejections: 0`) and add two cases:

```ts
    case 'APPEND_TURN': {
      const expected = state.transcript.length + 1
      if (action.turn.seq !== expected) {
        throw new Error(
          `Turn seq ${action.turn.seq} is not the next one (expected ${expected})`,
        )
      }
      return { ...state, transcript: [...state.transcript, action.turn] }
    }

    case 'RECORD_REJECTION':
      return { ...state, orchestratorRejections: state.orchestratorRejections + 1 }
```

- [ ] **Step 5: Extend the wire schema**

In `src/domain/application/action-schema.ts`, add Zod schemas for both variants and cases in `toAction`. The block schema is a discriminated union on `kind`; the turn schema is `.strict()` like every other variant:

```ts
const block = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field_ask'), fieldId: requirementKey }).strict(),
  z.object({ kind: z.literal('rationale'), fieldId: requirementKey }).strict(),
  z.object({ kind: z.literal('document_request'), docType: z.enum(ALL_DOC_TYPES) }).strict(),
  z.object({ kind: z.literal('orientation'), done: z.number().int(), total: z.number().int() }).strict(),
  z.object({ kind: z.literal('notice'), copyId: z.enum(ALL_COPY_IDS) }).strict(),
])

const turnSchema = z.object({
  seq: z.number().int().positive(),
  at: timestamp,
  role: z.enum(['agent', 'applicant']),
  voice: z.string().nullable(),
  voiceDropped: z.enum(['lint', 'sensitive']).optional(),
  blocks: z.array(block),
  text: z.string().optional(),
}).strict()

const appendTurn = z.object({
  type: z.literal('APPEND_TURN'), turn: turnSchema, at: timestamp,
}).strict()

const recordRejection = z.object({
  type: z.literal('RECORD_REJECTION'), at: timestamp,
}).strict()
```

Add both to the `actionSchema` union and to `toAction`, re-attaching `voiceDropped` and `text` one at a time the way the existing code does for optionals (`exactOptionalPropertyTypes` treats a present-and-undefined key as real).

- [ ] **Step 6: Run the transcript, reducer and schema tests**

Run: `npx vitest run tests/domain/orchestrator/transcript.test.ts tests/domain/application` → PASS

- [ ] **Step 7: Sabotage check**

Remove the `seq` check in `APPEND_TURN`. Confirm **"refuses a turn whose seq is not the next one"** goes red. Revert.

- [ ] **Step 8: Full suite and typecheck**

Run: `npm test && npm run typecheck` → both clean. Adding two fields to `ApplicationState` may break fixtures that build one by hand; fix each by adding the new fields rather than by loosening the type.

- [ ] **Step 9: Commit**

```bash
git add src/domain/orchestrator/transcript.ts src/domain/application tests/domain
git commit -m "feat(orchestrator): put the transcript on the application record"
```

---

### Task 6: Auditing turns

**Files:**
- Modify: `src/domain/audit/event.ts`, `src/domain/audit/log.ts`, `src/domain/orchestrator/transcript.ts`, `src/domain/application/action-schema.ts`
- Test: extend `tests/domain/audit/log.test.ts`, `tests/domain/orchestrator/transcript.test.ts`

**Interfaces:**
- Consumes: `Turn`, `Block` from `@/domain/orchestrator/transcript`; `COPY_VERSION`, `vettedCopy` from `@/domain/orchestrator/copy`; the existing `Digester`.
- Produces: `AuditKind` gains `'agent_turn' | 'applicant_message'`; `Turn` gains `rejections?: readonly string[]`; `shownCopyMaterial(blocks, labelOf)` exported from `transcript.ts`; `AuditEvent` gains `turnSeq?`, `shownCopyHash?` (already present), `voiceDropped?`, `rejections?`.

**Design correction, read this first.** An earlier draft of this plan gave `AuditLog` a
separate `appendTurn(...)` method, reasoning that a turn is not a field mutation. Task 5
dissolved that reasoning: appending a turn **is** an `Action` (`APPEND_TURN`), and it
commits through `applyAction` → `commit()` → `log.append` like every other action. A second
append call alongside that path would write two audit events for one turn.

So turn content goes **inside `AuditLog.append`'s existing per-kind branches**, beside
`valuePart`, `confirmPart`, `rejectPart` and `profilePart`. Do not add a second method and
do not add a second call site. `commit()` stays the only write path.

Task 5 left placeholder kinds `turn_appended` and `rejection_recorded` in the `KIND` map to
keep it exhaustive. `rejection_recorded` stays. `turn_appended` is replaced: an
`APPEND_TURN` event's kind depends on `turn.role`, which a static map cannot express, so
`append` selects it explicitly.

- [ ] **Step 1: Write the failing tests**

Extend `tests/domain/audit/log.test.ts`:

```ts
describe('agent turns', () => {
  const turn = {
    seq: 1, at: '2026-08-03T00:00:00.000Z', role: 'agent' as const,
    voice: 'Right, a couple more.',
    blocks: [{ kind: 'field_ask' as const, fieldId: 'first_name' }],
  }
  const appendTurnAction = (t: typeof turn) =>
    ({ type: 'APPEND_TURN' as const, turn: t, at: t.at })

  it('records an agent turn under its own kind', () => {
    const log = new AuditLog(() => 'digest')
    const event = log.append('app-1', appendTurnAction(turn))
    expect(event.kind).toBe('agent_turn')
    expect(event.turnSeq).toBe(1)
    expect(event.shownCopyHash).toBe('digest')
  })

  it('records an applicant message under a different kind', () => {
    const log = new AuditLog(() => 'digest')
    const event = log.append('app-1', appendTurnAction({
      ...turn, role: 'applicant', voice: null, blocks: [], text: 'I am a dealer',
    }))
    expect(event.kind).toBe('applicant_message')
  })

  it('never writes the model voice text into the log', () => {
    const log = new AuditLog(() => 'digest')
    log.append('app-1', appendTurnAction(turn))
    expect(JSON.stringify(log.entriesFor('app-1'))).not.toContain('a couple more')
  })

  it('never writes what the applicant typed into the log', () => {
    const log = new AuditLog(() => 'digest')
    log.append('app-1', appendTurnAction({
      ...turn, role: 'applicant', voice: null, blocks: [], text: 'my ssn is 123456789',
    }))
    expect(JSON.stringify(log.entriesFor('app-1'))).not.toContain('123456789')
  })

  it('records why a voice was dropped', () => {
    const log = new AuditLog(() => 'digest')
    const event = log.append('app-1',
      appendTurnAction({ ...turn, voice: null, voiceDropped: 'lint' }))
    expect(event.voiceDropped).toBe('lint')
  })

  it('records guard rejection codes carried on the turn', () => {
    const log = new AuditLog(() => 'digest')
    const event = log.append('app-1',
      appendTurnAction({ ...turn, rejections: ['field_not_outstanding'] }))
    expect(event.rejections).toEqual(['field_not_outstanding'])
  })

  it('hashes what was shown through the injected digester', () => {
    const seen: string[] = []
    const log = new AuditLog((input) => { seen.push(input); return 'digest' })
    log.append('app-1', appendTurnAction(turn))
    expect(seen[0]).toContain('first_name')
  })

  it('shares one seq counter with field events', () => {
    const log = new AuditLog(() => 'digest')
    log.append('app-1', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'K',
      source: 'user', at: turn.at,
    })
    expect(log.append('app-1', appendTurnAction(turn)).seq).toBe(2)
  })
})
```

And in `tests/domain/orchestrator/transcript.test.ts`, pin the copy-hash relationship the
design requires — this closes a gap Task 3's review flagged and deferred here:

```ts
describe('shownCopyMaterial', () => {
  const labelOf = (id: string) => `Label for ${id}`
  const blocks = [{ kind: 'notice' as const, copyId: 'guard_fallback' as const }]

  it('is stable for the same blocks', () => {
    expect(shownCopyMaterial(blocks, labelOf)).toBe(shownCopyMaterial(blocks, labelOf))
  })

  it('carries the copy version, so a version bump changes the material', () => {
    expect(shownCopyMaterial(blocks, labelOf)).toContain(COPY_VERSION)
  })

  it('carries the resolved text, so editing a vetted string changes the material', () => {
    expect(shownCopyMaterial(blocks, labelOf)).toContain(vettedCopy('guard_fallback'))
  })

  it('distinguishes blocks that differ only by field id', () => {
    const a = [{ kind: 'field_ask' as const, fieldId: 'first_name' }]
    const b = [{ kind: 'field_ask' as const, fieldId: 'last_name' }]
    expect(shownCopyMaterial(a, labelOf)).not.toBe(shownCopyMaterial(b, labelOf))
  })
})
```

- [ ] **Step 2: Run and confirm they fail for the right reason**

Run: `npx vitest run tests/domain/audit/log.test.ts tests/domain/orchestrator/transcript.test.ts`
Expected: FAIL — `shownCopyMaterial` is not exported, and `event.kind` is `turn_appended` rather than `agent_turn`. Read the messages and confirm those are the failures, not a missing import.

- [ ] **Step 3: Add `rejections` to the Turn type and its schema**

In `src/domain/orchestrator/transcript.ts` add to `Turn`:

```ts
  /** Guard reason codes for tool calls refused on this turn. */
  rejections?: readonly string[]
```

and in `action-schema.ts` add `rejections: z.array(z.string().min(1)).optional()` to
`turnSchema`, re-attaching it in `toAction` with the same one-at-a-time pattern the other
optionals use.

- [ ] **Step 4: Add `shownCopyMaterial` to `transcript.ts`**

It goes here rather than in `copy.ts` because it needs both `Block` and `vettedCopy`, and
`transcript.ts` already imports from `copy.ts`. The reverse would make the two files import
each other.

```ts
import { COPY_VERSION, vettedCopy } from './copy'

/**
 * What the applicant was shown, as a stable string: the version, then each
 * block's identity and its resolved text. Hashed by the caller, which owns the
 * Digester — the domain stays free of the secret.
 */
export function shownCopyMaterial(
  blocks: readonly Block[],
  labelOf: (fieldId: RequirementKey) => string,
): string {
  const parts = blocks.map((b) => {
    switch (b.kind) {
      case 'field_ask': return `ask:${b.fieldId}:${labelOf(b.fieldId)}`
      case 'rationale': return `why:${b.fieldId}:${labelOf(b.fieldId)}`
      case 'document_request': return `doc:${b.docType}`
      case 'orientation': return `orient:${b.done}/${b.total}`
      case 'notice': return `notice:${b.copyId}:${vettedCopy(b.copyId)}`
    }
  })
  return `v${COPY_VERSION}|${parts.join('|')}`
}
```

- [ ] **Step 5: Extend `AuditEvent` and `AuditLog.append`**

In `src/domain/audit/event.ts` add `'agent_turn' | 'applicant_message'` to `AuditKind`,
remove `'turn_appended'`, and add the optional fields:

```ts
  /** The Turn.seq this event records. */
  turnSeq?: number
  /** Set when the voice slot was suppressed or linted away. */
  voiceDropped?: 'lint' | 'sensitive'
  /** Guard reason codes for tool calls refused this turn. */
  rejections?: readonly string[]
```

In `src/domain/audit/log.ts`, drop `APPEND_TURN` from the static `KIND` map (its kind is
role-dependent) and add a `turnPart` beside the existing `xPart` constants:

```ts
    let turnPart: Partial<AuditEvent> = {}
    if (action.type === 'APPEND_TURN') {
      const turn = action.turn
      turnPart = {
        turnSeq: turn.seq,
        shownCopyHash: this.#digest(
          shownCopyMaterial(turn.blocks, (id) => fieldDef(parseReqKey(id).fieldId).label),
        ),
        ...(turn.voiceDropped !== undefined && { voiceDropped: turn.voiceDropped }),
        ...(turn.rejections !== undefined && turn.rejections.length > 0
          && { rejections: Object.freeze([...turn.rejections]) }),
      }
    }
```

and select the kind:

```ts
    const kind: AuditKind = action.type === 'APPEND_TURN'
      ? (action.turn.role === 'agent' ? 'agent_turn' : 'applicant_message')
      : KIND[action.type]
```

**Neither `turn.voice` nor `turn.text` is written.** The voice is not legally operative by
construction — that is the whole point of the copy tiers — and writing model prose into a
compliance artefact invites it being read as though it were. The applicant's typed text is
free-form input that may contain anything they chose to type, including a value; the log is
not where that belongs.

- [ ] **Step 6: Run and confirm pass**

Run: `npx vitest run tests/domain/audit tests/domain/orchestrator` → PASS

- [ ] **Step 7: Sabotage checks**

1. Add `voice: action.turn.voice` to `turnPart`. Confirm **"never writes the model voice text into the log"** goes red naming the phrase. Revert.
2. Add `text: action.turn.text` to `turnPart`. Confirm **"never writes what the applicant typed into the log"** goes red naming the digits. Revert.
3. Make the kind selection always return `'agent_turn'`. Confirm **"records an applicant message under a different kind"** goes red. Revert.

Quote the actual assertion message for each.

- [ ] **Step 8: Verify, then commit**

Run `npm run typecheck` (zero errors) and `npm test` (green), quoting both.

```bash
git add src/domain/audit src/domain/orchestrator src/domain/application/action-schema.ts tests/domain
git commit -m "feat(audit): record agent turns with a hash of what was shown"
```


### Task 7: Tool schemas

**Files:**
- Create: `src/domain/orchestrator/tools.ts`
- Test: `tests/domain/orchestrator/tools.test.ts`

**Interfaces:**
- Consumes: `profilePatch` from `@/domain/application/action-schema`; `ALL_DOC_TYPES`.
- Produces: `ALL_TOOL_NAMES` (readonly tuple), `type ToolName`, `TOOL_SCHEMAS: Readonly<Record<ToolName, ZodTypeAny>>`, `TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>>`.

**Why this file has no `ai` import:** `tests/domain/purity.test.ts` bans it. The AI SDK `ToolSet` is assembled from these schemas in Task 9, in the server layer.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/orchestrator/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ALL_TOOL_NAMES, TOOL_SCHEMAS, TOOL_DESCRIPTIONS } from '@/domain/orchestrator/tools'

describe('tool schemas', () => {
  it('declares exactly the five tools the design allows', () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual(
      ['askFor', 'explain', 'orient', 'requestDocument', 'setProfile'],
    )
  })

  it('gives every tool a schema and a description', () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(TOOL_SCHEMAS[name], name).toBeDefined()
      expect(TOOL_DESCRIPTIONS[name].trim(), name).not.toBe('')
    }
  })

  it('tells the model when to call each tool, not just what it does', () => {
    // The descriptions are the only tool-selection signal the model gets.
    for (const name of ALL_TOOL_NAMES) {
      expect(TOOL_DESCRIPTIONS[name], name).toMatch(/\bCall this\b/)
    }
  })

  it('caps askFor at four fields and requires at least one', () => {
    expect(TOOL_SCHEMAS.askFor.safeParse({ fieldIds: [] }).success).toBe(false)
    expect(TOOL_SCHEMAS.askFor.safeParse({ fieldIds: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false)
    expect(TOOL_SCHEMAS.askFor.safeParse({ fieldIds: ['a'] }).success).toBe(true)
  })

  it('routes setProfile through the panel’s own profilePatch schema', () => {
    expect(TOOL_SCHEMAS.setProfile.safeParse({ patch: { state: 'GA' } }).success).toBe(true)
    expect(TOOL_SCHEMAS.setProfile.safeParse({ patch: { nonsense: 1 } }).success).toBe(false)
  })

  it('restricts requestDocument to declared document types', () => {
    expect(TOOL_SCHEMAS.requestDocument.safeParse({ docType: 'passport' }).success).toBe(true)
    expect(TOOL_SCHEMAS.requestDocument.safeParse({ docType: 'birth_certificate' }).success).toBe(false)
  })

  it('has no tool for setting a value, confirming, or submitting', () => {
    const forbidden = ['setValue', 'confirm', 'submit', 'verify', 'reject']
    for (const name of forbidden) expect(ALL_TOOL_NAMES).not.toContain(name)
  })
})
```

- [ ] **Step 2: Run and confirm it fails for the right reason**

Run: `npx vitest run tests/domain/orchestrator/tools.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/domain/orchestrator/tools.ts`:

```ts
import { z } from 'zod'
import { profilePatch } from '../application/action-schema'
import { ALL_DOC_TYPES } from '../field-id'

/**
 * The whole of the agent's authority. Anything absent here it cannot do,
 * whatever it emits — see guard.ts, which is what actually enforces that.
 *
 * No schema here builds an AI SDK tool: src/domain must not import `ai`.
 */
export const ALL_TOOL_NAMES = [
  'askFor', 'explain', 'setProfile', 'requestDocument', 'orient',
] as const

export type ToolName = (typeof ALL_TOOL_NAMES)[number]

export const TOOL_SCHEMAS = Object.freeze({
  askFor: z.object({ fieldIds: z.array(z.string().min(1)).min(1).max(4) }).strict(),
  explain: z.object({ fieldId: z.string().min(1) }).strict(),
  setProfile: z.object({ patch: profilePatch }).strict(),
  requestDocument: z.object({ docType: z.enum(ALL_DOC_TYPES) }).strict(),
  orient: z.object({}).strict(),
})

/**
 * Every description states WHEN to call, not just what the tool does. These
 * strings are the model's only signal for tool selection, so one that names
 * the action and stops is a tool the model will reach for at the wrong moment.
 */
export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = Object.freeze({
  askFor:
    'Ask the applicant for up to four outstanding fields. Call this whenever you are ready to collect answers and the applicant is not asking you a question. Prefer grouping fields that belong together — the parts of an address, a name and a date of birth — over asking one at a time. Each renders with its own vetted explanation. Only field ids listed as outstanding are accepted.',
  explain:
    'Show the vetted explanation for one field — what it is for and who requires it. Call this when the applicant asks why something is needed, hesitates over a field, or says they would rather not answer.',
  setProfile:
    'Record what the applicant told you about who they are: individual or business, their state, which licences they hold, whether they want GSA access, which form of ID they carry. Call this as soon as they mention any of it, including in passing. The requirements engine cannot tell what to ask for until the profile is set, and a fact left unrecorded is one you will ask for twice.',
  requestDocument:
    'Ask the applicant to photograph one document. Call this before asking for fields that document can fill in — one licence photo answers around eight questions, so requesting it first saves the applicant typing. Only documents this applicant actually owes are accepted.',
  orient:
    'Show a returning applicant how far through they are. Call this only on the first turn of a resumed application, before anything else.',
})
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/domain/orchestrator/tools.test.ts` → PASS

- [ ] **Step 5: Confirm purity**

Run: `npx vitest run tests/domain/purity.test.ts` → PASS.

- [ ] **Step 6: Sabotage check**

Change `.max(4)` to `.max(40)`. Confirm **"caps askFor at four fields"** goes red. Revert.

- [ ] **Step 7: Commit**

```bash
git add src/domain/orchestrator/tools.ts tests/domain/orchestrator/tools.test.ts
git commit -m "feat(orchestrator): declare the five tools and their schemas"
```

---

### Task 8: The guard

**Files:**
- Create: `src/domain/orchestrator/guard.ts`
- Test: `tests/domain/orchestrator/guard.test.ts`

**Interfaces:**
- Consumes: `TOOL_SCHEMAS`, `ToolName`; `outstandingFields`; `documentsToUpload`; `CATALOG`, `parseReqKey`; `ApplicationState`; `Block`.
- Produces:

```ts
export type RejectionCode =
  | 'ask_cardinality' | 'field_not_outstanding' | 'unknown_field'
  | 'duplicate_field' | 'malformed_patch' | 'empty_patch'
  | 'document_not_required' | 'document_already_held'
  | 'application_closed' | 'unknown_tool'

export type ToolCall = { toolName: string; input: unknown }

export type GuardOutcome =
  | { ok: true; blocks: readonly Block[]; actions: readonly Action[] }
  | { ok: false; code: RejectionCode }

export function guardToolCall(
  call: ToolCall,
  state: ApplicationState,
  uploadedDocs: readonly DocType[],
  at: string,
): GuardOutcome
```

- [ ] **Step 1: Write the failing test**

Create `tests/domain/orchestrator/guard.test.ts` covering every row of the spec's §6.1 table. One case per row; each asserts the code:

```ts
import { describe, it, expect } from 'vitest'
import { guardToolCall } from '@/domain/orchestrator/guard'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'

const AT = '2026-08-03T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }

function reject(call: Parameters<typeof guardToolCall>[0], state = fresh(), docs: string[] = []) {
  const outcome = guardToolCall(call, state, docs as never, AT)
  if (outcome.ok) throw new Error(`expected a rejection, got ${JSON.stringify(outcome)}`)
  return outcome.code
}

describe('guardToolCall rejections', () => {
  it('rejects an empty askFor', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: [] } })).toBe('ask_cardinality')
  })

  it('rejects an askFor of more than four fields', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['a','b','c','d','e'] } }))
      .toBe('ask_cardinality')
  })

  it('rejects a field that is not outstanding', () => {
    let state = fresh()
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'K', source: 'user', at: AT,
    })
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name'] } }, state))
      .toBe('field_not_outstanding')
  })

  it('rejects a field with no catalog entry', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['not_a_field'] } }))
      .toBe('unknown_field')
  })

  it('rejects a malformed requirement key', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name#x'] } }))
      .toBe('unknown_field')
  })

  it('rejects duplicate ids in one ask', () => {
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name', 'first_name'] } }))
      .toBe('duplicate_field')
  })

  it('rejects the whole ask when one id is bad', () => {
    const outcome = guardToolCall(
      { toolName: 'askFor', input: { fieldIds: ['first_name', 'not_a_field'] } },
      fresh(), [], AT,
    )
    expect(outcome.ok).toBe(false)
  })

  it('rejects a patch the panel schema would refuse', () => {
    expect(reject({ toolName: 'setProfile', input: { patch: { nonsense: true } } }))
      .toBe('malformed_patch')
  })

  it('rejects an empty patch', () => {
    expect(reject({ toolName: 'setProfile', input: { patch: {} } })).toBe('empty_patch')
  })

  it('rejects a document this applicant does not owe', () => {
    expect(reject({ toolName: 'requestDocument', input: { docType: 'proof_of_residency' } }))
      .toBe('document_not_required')
  })

  it('rejects a document already uploaded', () => {
    expect(reject(
      { toolName: 'requestDocument', input: { docType: 'drivers_license' } },
      fresh(), ['drivers_license'],
    )).toBe('document_already_held')
  })

  it('rejects everything once submitted', () => {
    const submitted = { ...fresh(), submittedAt: AT }
    expect(reject({ toolName: 'askFor', input: { fieldIds: ['first_name'] } }, submitted))
      .toBe('application_closed')
  })

  it('rejects a tool outside the five', () => {
    expect(reject({ toolName: 'setValue', input: { fieldId: 'tax_id', value: '1' } }))
      .toBe('unknown_tool')
  })
})

describe('guardToolCall acceptance', () => {
  it('accepts an ask for an outstanding field and produces a block', () => {
    const outcome = guardToolCall(
      { toolName: 'askFor', input: { fieldIds: ['first_name'] } }, fresh(), [], AT,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.blocks).toEqual([{ kind: 'field_ask', fieldId: 'first_name' }])
    expect(outcome.actions).toEqual([])
  })

  it('turns setProfile into an UPDATE_PROFILE action', () => {
    const outcome = guardToolCall(
      { toolName: 'setProfile', input: { patch: { state: 'OH' } } }, fresh(), [], AT,
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.actions).toEqual([
      { type: 'UPDATE_PROFILE', patch: { state: 'OH' }, at: AT },
    ])
  })
})
```

- [ ] **Step 2: Run and confirm it fails for the right reason**

Run: `npx vitest run tests/domain/orchestrator/guard.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/domain/orchestrator/guard.ts`. Order matters: the closed check runs before anything else, and `askFor` is validated as a unit.

```ts
import { toAction } from '../application/action-schema'
import { outstandingFields } from '../application/queries'
import type { Action, ApplicationState } from '../application/state'
import { CATALOG } from '../catalog'
import type { DocType } from '../field-id'
import { documentsToUpload } from '../requirements/documents'
import { parseReqKey } from '../requirements/key'
import type { Block } from './transcript'
import { ALL_TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from './tools'

export type RejectionCode =
  | 'ask_cardinality' | 'field_not_outstanding' | 'unknown_field'
  | 'duplicate_field' | 'malformed_patch' | 'empty_patch'
  | 'document_not_required' | 'document_already_held'
  | 'application_closed' | 'unknown_tool'

export type ToolCall = { toolName: string; input: unknown }

export type GuardOutcome =
  | { ok: true; blocks: readonly Block[]; actions: readonly Action[] }
  | { ok: false; code: RejectionCode }

const reject = (code: RejectionCode): GuardOutcome => ({ ok: false, code })

export function guardToolCall(
  call: ToolCall,
  state: ApplicationState,
  uploadedDocs: readonly DocType[],
  at: string,
): GuardOutcome {
  if (state.submittedAt !== null) return reject('application_closed')
  if (!(ALL_TOOL_NAMES as readonly string[]).includes(call.toolName)) {
    return reject('unknown_tool')
  }
  const name = call.toolName as ToolName
  const parsed = TOOL_SCHEMAS[name].safeParse(call.input)

  switch (name) {
    case 'askFor': {
      if (!parsed.success) return reject('ask_cardinality')
      const { fieldIds } = parsed.data as { fieldIds: string[] }
      if (new Set(fieldIds).size !== fieldIds.length) return reject('duplicate_field')
      const outstanding = new Set(outstandingFields(state))
      for (const id of fieldIds) {
        if (!knownField(id)) return reject('unknown_field')
        if (!outstanding.has(id)) return reject('field_not_outstanding')
      }
      return {
        ok: true,
        blocks: fieldIds.map((fieldId) => ({ kind: 'field_ask', fieldId })),
        actions: [],
      }
    }

    case 'explain': {
      if (!parsed.success) return reject('unknown_field')
      const { fieldId } = parsed.data as { fieldId: string }
      if (!knownField(fieldId)) return reject('unknown_field')
      const known = new Set([...outstandingFields(state), ...Object.keys(state.fields)])
      if (!known.has(fieldId)) return reject('unknown_field')
      return { ok: true, blocks: [{ kind: 'rationale', fieldId }], actions: [] }
    }

    case 'setProfile': {
      if (!parsed.success) return reject('malformed_patch')
      const { patch } = parsed.data as { patch: Record<string, unknown> }
      if (Object.keys(patch).length === 0) return reject('empty_patch')
      // Built directly rather than through `toAction`: profilePatch has
      // already validated the shape, and routing a typed value back through
      // the wire parser would need a cast to satisfy it.
      return {
        ok: true,
        blocks: [],
        actions: [{ type: 'UPDATE_PROFILE', patch, at }],
      }
    }

    case 'requestDocument': {
      if (!parsed.success) return reject('document_not_required')
      const { docType } = parsed.data as { docType: DocType }
      if (!documentsToUpload(state.profile).includes(docType)) {
        return reject('document_not_required')
      }
      if (uploadedDocs.includes(docType)) return reject('document_already_held')
      return { ok: true, blocks: [{ kind: 'document_request', docType }], actions: [] }
    }

    case 'orient': {
      // Counted off what the engine requires, not off recorded keys:
      // `outstandingFields` filters on status, so a field that is recorded
      // but not yet satisfied — every OCR-derived one — would be counted in
      // both terms of a sum. The number is hashed onto the record, so a
      // wrong one is not merely cosmetic.
      const total = requiredFields(state.profile).length
      return {
        ok: true,
        blocks: [{
          kind: 'orientation',
          done: total - outstandingFields(state).length,
          total,
        }],
        actions: [],
      }
    }
  }
}

function knownField(key: string): boolean {
  try {
    return CATALOG.has(parseReqKey(key).fieldId)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/domain/orchestrator/guard.test.ts` → PASS (15 tests)

- [ ] **Step 5: Sabotage checks — three of them**

1. Remove the `outstanding.has(id)` check. Confirm **"rejects a field that is not outstanding"** goes red.
2. Change the duplicate check to always pass. Confirm **"rejects duplicate ids in one ask"** goes red.
3. Move the `submittedAt` check to the bottom of the function. Confirm **"rejects everything once submitted"** goes red.

Each must fail naming its own assertion. Revert after each.

- [ ] **Step 6: Commit**

```bash
git add src/domain/orchestrator/guard.ts tests/domain/orchestrator/guard.test.ts
git commit -m "feat(orchestrator): refuse any tool call the engine did not ask for"
```

---

### Task 9: The AI SDK tool set

**Files:**
- Create: `src/server/orchestrator/tool-set.ts`
- Test: `tests/server/orchestrator/tool-set.test.ts`

**Interfaces:**
- Consumes: `TOOL_SCHEMAS`, `TOOL_DESCRIPTIONS`, `ALL_TOOL_NAMES`, `ToolName`; `OrchestratorView`.
- Produces: `buildToolSet(): ToolSet` and `activeToolsFor(view: OrchestratorView, isResume: boolean): ToolName[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/orchestrator/tool-set.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildToolSet, activeToolsFor } from '@/server/orchestrator/tool-set'
import { ALL_TOOL_NAMES } from '@/domain/orchestrator/tools'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const view = (over: Partial<OrchestratorView> = {}): OrchestratorView => ({
  applicationId: 'app-1',
  profile: {
    applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
    licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  },
  outstanding: [{ id: 'first_name', label: 'First name', status: 'empty', sensitive: false }],
  settled: [],
  documentsOutstanding: ['drivers_license'],
  submitted: false,
  rulesVersion: 1,
  ...over,
})

describe('buildToolSet', () => {
  it('exposes every declared tool', () => {
    expect(Object.keys(buildToolSet()).sort()).toEqual([...ALL_TOOL_NAMES].sort())
  })

  it('gives no tool an execute function — the guard decides, not the SDK', () => {
    // `in` rather than a cast: the property must be absent, not merely
    // undefined, and this asserts that without an `as`.
    for (const [name, tool] of Object.entries(buildToolSet())) {
      expect('execute' in tool, name).toBe(false)
    }
  })
})

describe('activeToolsFor', () => {
  // Each condition is asserted in BOTH directions. A negative-only test
  // passes just as happily when the condition is deleted outright, which is
  // the failure mode this codebase keeps hitting.

  it('offers orient only on a resume', () => {
    expect(activeToolsFor(view(), false)).not.toContain('orient')
    expect(activeToolsFor(view(), true)).toContain('orient')
  })

  it('offers requestDocument when a document is owed, and not otherwise', () => {
    expect(activeToolsFor(view(), false)).toContain('requestDocument')
    expect(activeToolsFor(view({ documentsOutstanding: [] }), false))
      .not.toContain('requestDocument')
  })

  it('offers askFor when something is outstanding, and not otherwise', () => {
    expect(activeToolsFor(view(), false)).toContain('askFor')
    expect(activeToolsFor(view({ outstanding: [] }), false)).not.toContain('askFor')
  })

  it('always offers explain and setProfile before submission', () => {
    const bare = activeToolsFor(view({ outstanding: [], documentsOutstanding: [] }), false)
    expect(bare).toContain('explain')
    expect(bare).toContain('setProfile')
  })
})
```

- [ ] **Step 2: Run and confirm it fails for the right reason**

Run: `npx vitest run tests/server/orchestrator/tool-set.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/server/orchestrator/tool-set.ts`:

```ts
import { tool, type ToolSet } from 'ai'
import {
  ALL_TOOL_NAMES, TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type ToolName,
} from '@/domain/orchestrator/tools'
import type { OrchestratorView } from '@/domain/orchestrator/view'

/**
 * No tool carries an execute function. The SDK returns the calls and
 * guardToolCall decides — an execute here would be a second, unguarded path
 * into the application.
 */
export function buildToolSet(): ToolSet {
  const set: Record<string, ReturnType<typeof tool>> = {}
  for (const name of ALL_TOOL_NAMES) {
    set[name] = tool({
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: TOOL_SCHEMAS[name],
    })
  }
  return set as ToolSet
}

/** Narrows the offer to what is legal now. Defence in depth; the guard still runs. */
export function activeToolsFor(view: OrchestratorView, isResume: boolean): ToolName[] {
  const active: ToolName[] = ['explain', 'setProfile']
  if (view.outstanding.length > 0) active.push('askFor')
  if (view.documentsOutstanding.length > 0) active.push('requestDocument')
  if (isResume) active.push('orient')
  return active
}
```

`execute` is optional in `ai@7` — the `Tool` type has a schema-only form documented as "does not execute the tool". Verified against the installed typings, so pass no `execute` and expect the test above to hold. Do not add a throwing stub "just in case": an `execute` that exists is a second path into the application, and the guard is the only one there should be.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/server/orchestrator/tool-set.test.ts` → PASS

- [ ] **Step 5: Sabotage check**

Add `execute: async () => 'ok'` to the `tool({...})` call. Confirm **"gives no tool an execute function"** goes red naming a tool. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/server/orchestrator/tool-set.ts tests/server/orchestrator/tool-set.test.ts
git commit -m "feat(orchestrator): build the tool set without execute"
```

---

### Task 10: Prompt assembly

**Files:**
- Create: `src/server/orchestrator/prompt.ts`
- Test: `tests/server/orchestrator/prompt.test.ts`

**Interfaces:**
- Consumes: `OrchestratorView`, `Turn`, `Block`.
- Produces: `systemPrompt(): string` and `messagesFor(view: OrchestratorView, transcript: readonly Turn[], userText: string | null): ModelMessage[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/orchestrator/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { systemPrompt, messagesFor } from '@/server/orchestrator/prompt'
import type { Turn } from '@/domain/orchestrator/transcript'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const view: OrchestratorView = {
  applicationId: 'app-1',
  profile: {
    applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
    licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  },
  outstanding: [{ id: 'tax_id', label: 'Taxpayer ID', status: 'empty', sensitive: true }],
  settled: [],
  documentsOutstanding: [],
  submitted: false,
  rulesVersion: 1,
}

describe('systemPrompt', () => {
  it('is stable across calls so it can be a cacheable prefix', () => {
    expect(systemPrompt()).toBe(systemPrompt())
  })

  it('tells the model it never authors compliance copy', () => {
    expect(systemPrompt()).toMatch(/never/i)
  })
})

describe('messagesFor', () => {
  const agentTurn: Turn = {
    seq: 1, at: '2026-08-03T00:00:00.000Z', role: 'agent',
    voice: 'Right, a couple more.',
    blocks: [{ kind: 'field_ask', fieldId: 'tax_id' }],
  }

  it('renders an agent turn as its voice plus block identifiers', () => {
    const [first] = messagesFor(view, [agentTurn], null)
    const text = JSON.stringify(first)
    expect(text).toContain('Right, a couple more.')
    expect(text).toContain('tax_id')
  })

  it('never renders the resolved vetted copy of a block', () => {
    const withNotice: Turn = {
      ...agentTurn, blocks: [{ kind: 'notice', copyId: 'opening_beat' }],
    }
    const text = JSON.stringify(messagesFor(view, [withNotice], null))
    expect(text).not.toContain('four minutes')
  })

  it('carries the applicant’s typed text', () => {
    const text = JSON.stringify(messagesFor(view, [], 'I am a dealer in Georgia'))
    expect(text).toContain('I am a dealer in Georgia')
  })

  it('puts the view in the prompt without any field value', () => {
    const text = JSON.stringify(messagesFor(view, [], null))
    expect(text).toContain('tax_id')
    expect(text).toContain('Taxpayer ID')
  })
})
```

- [ ] **Step 2: Run and confirm it fails for the right reason**

Run: `npx vitest run tests/server/orchestrator/prompt.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/server/orchestrator/prompt.ts`. The system prompt is a module constant so it is byte-identical between calls and can sit at the front of a cacheable prefix.

```ts
import type { ModelMessage } from 'ai'
import type { Block, Turn } from '@/domain/orchestrator/transcript'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const SYSTEM = [
  "You are the registration agent for IAA's buyer onboarding.",
  '',
  'You choose what to ask next and how to frame it. You never author the words that explain why something is required, what it is used for, or what it is legally for — those come from a vetted catalog and are rendered for you when you call a tool.',
  '',
  'Rules you cannot break:',
  '- You never see and never ask for the applicant\'s answers. Values are entered in the panel beside you.',
  '- You only ask for fields listed as outstanding. Asking for anything else is refused.',
  '- Your own words go in a short preamble only, and must contain no numerals, no percentages, no statute references, and no statements about legal obligation.',
  '- You do not decide when the application is complete.',
  '',
  'Keep your preamble to one or two short sentences. Warm, plain, unhurried.',
].join('\n')

export function systemPrompt(): string {
  return SYSTEM
}

export function messagesFor(
  view: OrchestratorView,
  transcript: readonly Turn[],
  userText: string | null,
): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (const turn of transcript) {
    if (turn.role === 'applicant') {
      if (turn.text) messages.push({ role: 'user', content: turn.text })
      continue
    }
    const parts = [turn.voice, describeBlocks(turn.blocks)].filter(Boolean)
    if (parts.length > 0) messages.push({ role: 'assistant', content: parts.join('\n') })
  }

  messages.push({ role: 'user', content: renderView(view) })
  if (userText) messages.push({ role: 'user', content: userText })
  return messages
}

/** Identifiers only. The resolved copy is not sent — it is bulk with no value here. */
function describeBlocks(blocks: readonly Block[]): string {
  if (blocks.length === 0) return ''
  const parts = blocks.map((b) => {
    switch (b.kind) {
      case 'field_ask': return `asked for: ${b.fieldId}`
      case 'rationale': return `explained: ${b.fieldId}`
      case 'document_request': return `requested document: ${b.docType}`
      case 'orientation': return 'showed progress'
      case 'notice': return `showed notice: ${b.copyId}`
    }
  })
  return `[${parts.join('; ')}]`
}

function renderView(view: OrchestratorView): string {
  return [
    'Current state of this application:',
    JSON.stringify({
      profile: view.profile,
      outstanding: view.outstanding,
      settled: view.settled.map((f) => f.id),
      documentsOutstanding: view.documentsOutstanding,
    }, null, 2),
  ].join('\n')
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/server/orchestrator/prompt.test.ts` → PASS

- [ ] **Step 5: Sabotage check**

Make `describeBlocks` resolve notice copy via `vettedCopy(b.copyId)`. Confirm **"never renders the resolved vetted copy of a block"** goes red naming `four minutes`. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/server/orchestrator/prompt.ts tests/server/orchestrator/prompt.test.ts
git commit -m "feat(orchestrator): assemble the prompt from the redacted view"
```

---

### Task 11: The turn service

**Files:**
- Create: `src/server/orchestrator/service.ts`
- Test: `tests/server/orchestrator/service.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 4, 7–10.
- Produces:

```ts
export type TurnRequest = {
  model: LanguageModel
  view: OrchestratorView
  state: ApplicationState
  transcript: readonly Turn[]
  uploadedDocs: readonly DocType[]
  userText: string | null
  isResume: boolean
  at: string
  effort: string
  isAnthropic: boolean
}

export type TurnResult = {
  turn: Turn
  actions: readonly Action[]
  rejections: readonly RejectionCode[]
}

export async function runTurn(request: TurnRequest): Promise<TurnResult>
```

- [ ] **Step 1: Build the shared stub-model helper**

`ai@7` ships `MockLanguageModelV4` at `ai/test`, and it records every call in `doGenerateCalls` — so no hand-rolled stub is needed, and Task 13 reuses the same capture.

Create `tests/server/orchestrator/stub-model.ts`:

```ts
import { MockLanguageModelV4 } from 'ai/test'

export type StubCall = { toolName: string; input: unknown }

/**
 * `LanguageModelV4ToolCall.input` is a JSON *string* on the wire; generateText
 * parses it before handing it to us. The stub must therefore stringify.
 */
export function stubModel(text: string, calls: readonly StubCall[] = []) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        { type: 'text' as const, text },
        ...calls.map((c, i) => ({
          type: 'tool-call' as const,
          toolCallId: `call-${i}`,
          toolName: c.toolName,
          input: JSON.stringify(c.input),
        })),
      ],
      finishReason: 'stop' as const,
      usage: USAGE,
    }),
  })
}
```

`LanguageModelV4Usage` is a nested object (`inputTokens: { total, noCache, ... }`), not two flat numbers. **Do not guess its shape.** Write `const USAGE = {}` first, run `npm run typecheck`, and let the compiler name each missing field. That loop reaches a correct literal faster than reading the whole type, and it cannot be wrong.

- [ ] **Step 2: Write the failing test**

Create `tests/server/orchestrator/service.test.ts`. Every case is written out — a test whose body is a comment is a test that cannot fail.

```ts
import { describe, it, expect } from 'vitest'
import { runTurn } from '@/server/orchestrator/service'
import { toOrchestratorView } from '@/domain/orchestrator/view'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { Turn } from '@/domain/orchestrator/transcript'
import { stubModel } from './stub-model'

const AT = '2026-08-03T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }

async function run(
  text: string,
  calls: Parameters<typeof stubModel>[1],
  state = fresh(),
  transcript: readonly Turn[] = [],
) {
  return runTurn({
    model: stubModel(text, calls),
    view: toOrchestratorView(state, []),
    state, transcript, uploadedDocs: [], userText: null,
    isResume: false, at: AT, effort: 'low', isAnthropic: false,
  })
}

const ASK_NAME = [{ toolName: 'askFor', input: { fieldIds: ['first_name'] } }]

describe('runTurn', () => {
  it('keeps voice that passes the lint', async () => {
    const { turn } = await run('Right — a couple more.', ASK_NAME)
    expect(turn.voice).toBe('Right — a couple more.')
    expect(turn.voiceDropped).toBeUndefined()
  })

  it('drops voice that fails the lint and records why', async () => {
    const { turn } = await run('You have 3 things left.', ASK_NAME)
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('lint')
  })

  it('suppresses voice entirely when the ask includes a sensitive field', async () => {
    const { turn } = await run('All good, one more.', [
      { toolName: 'askFor', input: { fieldIds: ['tax_id'] } },
    ])
    expect(turn.voice).toBeNull()
    expect(turn.voiceDropped).toBe('sensitive')
  })

  it('drops a rejected tool call and records its code', async () => {
    let state = fresh()
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'K', source: 'user', at: AT,
    })
    const { turn, rejections } = await run('Sure.', ASK_NAME, state)
    expect(rejections).toContain('field_not_outstanding')
    expect(turn.blocks).not.toContainEqual({ kind: 'field_ask', fieldId: 'first_name' })
  })

  it('falls back to a server-built ask when nothing survives', async () => {
    const { turn } = await run('Sure.', [
      { toolName: 'askFor', input: { fieldIds: ['not_a_field'] } },
    ])
    expect(turn.blocks).toContainEqual({ kind: 'notice', copyId: 'guard_fallback' })
    expect(turn.blocks.some((b) => b.kind === 'field_ask')).toBe(true)
  })

  it('applies surviving calls even when a sibling was rejected', async () => {
    const { turn, rejections } = await run('Sure.', [
      { toolName: 'askFor', input: { fieldIds: ['first_name'] } },
      { toolName: 'requestDocument', input: { docType: 'proof_of_residency' } },
    ])
    expect(turn.blocks).toContainEqual({ kind: 'field_ask', fieldId: 'first_name' })
    expect(rejections).toEqual(['document_not_required'])
  })

  it('numbers the turn as the next in the transcript', async () => {
    const prior: Turn[] = [
      { seq: 1, at: AT, role: 'agent', voice: null, blocks: [] },
      { seq: 2, at: AT, role: 'applicant', voice: null, blocks: [], text: 'hi' },
    ]
    const { turn } = await run('Sure.', ASK_NAME, fresh(), prior)
    expect(turn.seq).toBe(3)
  })
})
```

- [ ] **Step 3: Run and confirm it fails for the right reason**

Run: `npx vitest run tests/server/orchestrator/service.test.ts` → FAIL, module not found.

- [ ] **Step 4: Implement**

Create `src/server/orchestrator/service.ts`:

```ts
import { generateText } from 'ai'
import { outstandingFields } from '@/domain/application/queries'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { guardToolCall, type RejectionCode } from '@/domain/orchestrator/guard'
import type { Block, Turn } from '@/domain/orchestrator/transcript'
import { lintVoice } from '@/domain/orchestrator/voice-lint'
import { fieldDef } from '@/domain/catalog'
import { parseReqKey } from '@/domain/requirements/key'
import { messagesFor, systemPrompt } from './prompt'
import { activeToolsFor, buildToolSet } from './tool-set'

export async function runTurn(request: TurnRequest): Promise<TurnResult> {
  const result = await generateText({
    model: request.model,
    system: systemPrompt(),
    messages: messagesFor(request.view, request.transcript, request.userText),
    tools: buildToolSet(),
    activeTools: activeToolsFor(request.view, request.isResume),
    ...(request.isAnthropic && {
      providerOptions: { anthropic: { effort: request.effort } },
    }),
  })

  const blocks: Block[] = []
  const actions = []
  const rejections: RejectionCode[] = []

  for (const call of result.toolCalls) {
    const outcome = guardToolCall(
      { toolName: call.toolName, input: call.input },
      request.state, request.uploadedDocs, request.at,
    )
    if (!outcome.ok) { rejections.push(outcome.code); continue }
    blocks.push(...outcome.blocks)
    actions.push(...outcome.actions)
  }

  if (blocks.length === 0 && actions.length === 0) {
    blocks.push({ kind: 'notice', copyId: 'guard_fallback' })
    const [next] = outstandingFields(request.state)
    if (next) blocks.push({ kind: 'field_ask', fieldId: next })
  }

  const voice = decideVoice(result.text, blocks)

  return {
    turn: {
      seq: request.transcript.length + 1,
      at: request.at,
      role: 'agent',
      voice: voice.text,
      ...(voice.dropped !== undefined && { voiceDropped: voice.dropped }),
      blocks,
    },
    actions,
    rejections,
  }
}

function decideVoice(
  text: string,
  blocks: readonly Block[],
): { text: string | null; dropped?: 'lint' | 'sensitive' } {
  const asksSensitive = blocks.some(
    (b) => b.kind === 'field_ask' && fieldDef(parseReqKey(b.fieldId).fieldId).sensitive === true,
  )
  if (asksSensitive) return { text: null, dropped: 'sensitive' }

  const trimmed = text.trim()
  if (trimmed === '') return { text: null }
  return lintVoice(trimmed).ok ? { text: trimmed } : { text: null, dropped: 'lint' }
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run tests/server/orchestrator/service.test.ts` → PASS

- [ ] **Step 6: Sabotage checks**

1. Remove the `asksSensitive` branch. Confirm **"suppresses voice entirely when the ask includes a sensitive field"** goes red.
2. Make the guard loop `continue` on success instead of failure. Confirm the acceptance cases go red rather than the whole file erroring.

Revert each.

- [ ] **Step 7: Commit**

```bash
git add src/server/orchestrator/service.ts tests/server/orchestrator/service.test.ts
git commit -m "feat(orchestrator): run one buffered, linted, guarded turn"
```

---

### Task 12: The turn route

**Files:**
- Create: `src/app/api/application/[id]/turn/route.ts`
- Modify: `src/server/application-service.ts` (add `applyTurn`)
- Test: `tests/integration/turn-route.test.ts`

**Interfaces:**
- Consumes: `runTurn`, `resolveModel`, `readConfig`, `toOrchestratorView`, `getAuditLog`, `ownerTokenOf`, `getApplication`/`putApplication`, `shownCopyMaterial`.
- Produces: `POST /api/application/[id]/turn` accepting `{ text?: string }` and returning `{ state, turn }`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/turn-route.test.ts`. Read `tests/integration/route-handlers.test.ts` first and copy its setup exactly — how it builds a `Request`, passes `params`, and resets the store and audit log between cases. The model is injected by having the route call an overridable `modelForTurn()` that tests stub; do not reach for network mocking.

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { POST as turn } from '@/app/api/application/[id]/turn/route'
import { __resetStoreForTests, getApplication, putApplication } from '@/server/store'
import { __resetAuditLogForTests, getAuditLog } from '@/server/audit'
import { createApplication } from '@/domain/application/reducer'
import { OWNER_TOKEN_HEADER } from '@/server/ownership'

const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
}

function seed(id = 'app-1', token = 'tok') {
  const state = createApplication(id, PROFILE, token)
  putApplication(state)
  return state
}

function post(id: string, body: unknown, token: string | null = 'tok') {
  return turn(
    new Request(`http://test/api/application/${id}/turn`, {
      method: 'POST',
      headers: token ? { [OWNER_TOKEN_HEADER]: token } : {},
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => { __resetStoreForTests(); __resetAuditLogForTests() })

describe('POST /turn', () => {
  it('answers 404 for an unknown id', async () => {
    expect((await post('nope', {})).status).toBe(404)
  })

  it('answers 404 for a wrong token, the same as for an unknown id', async () => {
    seed()
    expect((await post('app-1', {}, 'wrong')).status).toBe(404)
  })

  it('answers 409 once submitted', async () => {
    putApplication({ ...seed(), submittedAt: '2026-08-03T00:00:00.000Z' })
    expect((await post('app-1', {})).status).toBe(409)
  })

  it('appends exactly one agent turn to the transcript', async () => {
    seed()
    await post('app-1', {})
    expect(getApplication('app-1')?.transcript).toHaveLength(1)
  })

  it('appends the applicant turn before the agent turn', async () => {
    seed()
    await post('app-1', { text: 'I am a dealer' })
    const roles = getApplication('app-1')?.transcript.map((t) => t.role)
    expect(roles).toEqual(['applicant', 'agent'])
  })

  it('writes one agent_turn audit event carrying a shownCopyHash', async () => {
    seed()
    await post('app-1', {})
    const events = getAuditLog().entriesFor('app-1')
      .filter((e) => e.kind === 'agent_turn')
    expect(events).toHaveLength(1)
    expect(events[0].shownCopyHash).toBeTruthy()
  })

  it('counts a guard rejection on the record', async () => {
    seed()
    // Stub the model to ask for a field that is not outstanding.
    await post('app-1', {})
    expect(getApplication('app-1')?.orchestratorRejections).toBeGreaterThan(0)
  })

  it('drops to panel-only on the third rejection', async () => {
    seed()
    for (let i = 0; i < 3; i += 1) await post('app-1', {})
    const last = getApplication('app-1')?.transcript.at(-1)
    expect(last?.blocks).toContainEqual({ kind: 'notice', copyId: 'panel_only_notice' })
  })

  it('returns a degraded notice when the model throws, leaving fields untouched', async () => {
    const before = seed()
    // Stub the model to reject.
    const response = await post('app-1', {})
    expect(response.status).toBe(200)
    const after = getApplication('app-1')
    expect(after?.fields).toEqual(before.fields)
    expect(after?.transcript.at(-1)?.blocks)
      .toContainEqual({ kind: 'notice', copyId: 'degraded_notice' })
  })
})
```

The three cases marked with a stubbing comment need the model stubbed per case rather than globally — wire that through whatever seam the route exposes, and make the seam explicit in the route rather than reaching into module internals from the test.

- [ ] **Step 2: Run and confirm it fails for the right reason**

Run: `npx vitest run tests/integration/turn-route.test.ts` → FAIL, route module not found.

- [ ] **Step 3: Implement `applyTurn` in the application service**

It must, in order: load the owned application; refuse if submitted; append the applicant turn if there is text; run the turn; apply each returned action through the existing `commit` path so carry and auditing still happen; append the agent turn; record one `RECORD_REJECTION` per rejection; write the audit event with `shownCopyHash = digest(shownCopyMaterial(blocks, labelOf))`; persist once.

Auditing happens before the store write, matching `commit`'s existing rule that an append which throws leaves the previous state in place.

- [ ] **Step 4: Implement the route**

Follow `src/app/api/application/[id]/actions/route.ts` exactly for shape: parse JSON, `safeParse` a `.strict()` body schema, `ownerTokenOf(request)`, return `jsonError(result.failure)` or `NextResponse.json(result.value)`.

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run tests/integration/turn-route.test.ts` → PASS

- [ ] **Step 6: Sabotage check**

Make the panel-only threshold 300 instead of 3. Confirm **"the third rejection renders a panel_only_notice"** goes red. Revert.

- [ ] **Step 7: Full suite**

Run: `npm test && npm run typecheck && npm run build` → all clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/application src/server/application-service.ts tests/integration/turn-route.test.ts
git commit -m "feat(orchestrator): serve one guarded turn over the wire"
```

---

### Task 13: The redaction test that matters most

**Files:**
- Test: `tests/integration/pii-boundary.test.ts`

**Interfaces:**
- Consumes: the turn route, and a stub model that **captures** its call options.

This task adds no production code. It is the §13 highest-priority test, and it asserts absence at the real boundary rather than at the view.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ALL_FIELDS } from '@/domain/catalog'
import { toOrchestratorView } from '@/domain/orchestrator/view'
import { runTurn } from '@/server/orchestrator/service'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import { stubModel } from '../server/orchestrator/stub-model'

const AT = '2026-08-03T00:00:00.000Z'

/** Distinctive per field, so a leak names the field that leaked. */
const valueFor = (id: string) => `VALUE_FOR_${id}`

/**
 * Every field the catalog declares, each carrying its own marker. Values that
 * the field's own schema would reject are irrelevant here: the reducer stores
 * what it is given, and this test is about transmission, not validation.
 */
function everythingFilled(): ApplicationState {
  let state = createApplication('app-1', {
    applicantType: 'business', country: 'US', state: 'GA', wantsGsa: true,
    licenses: ['dealer'], addressDiffersFromId: true, idForm: 'drivers_license',
  }, 'tok')
  for (const def of ALL_FIELDS) {
    state = {
      ...state,
      fields: {
        ...state.fields,
        [def.id]: { value: valueFor(def.id), status: 'confirmed' as const },
      },
    }
  }
  return state
}

/** Everything the SDK would send: system prompt, messages, tool schemas. */
async function capturedPayload(): Promise<string> {
  const state = everythingFilled()
  const model = stubModel('Right.', [])
  await runTurn({
    model,
    view: toOrchestratorView(state, []),
    state, transcript: [], uploadedDocs: [], userText: null,
    isResume: false, at: AT, effort: 'low', isAnthropic: false,
  })
  expect(model.doGenerateCalls.length).toBe(1)
  return JSON.stringify(model.doGenerateCalls[0])
}

describe('no field value reaches the model', () => {
  let payload: string
  beforeEach(async () => { payload = await capturedPayload() })

  it('transmits no value of any field lacking orchestratorVisible', () => {
    const hidden = ALL_FIELDS.filter(
      (d) => (d as { orchestratorVisible?: boolean }).orchestratorVisible !== true,
    )
    expect(hidden.length).toBeGreaterThan(20)
    for (const def of hidden) {
      expect(payload, `leaked ${def.id}`).not.toContain(valueFor(def.id))
    }
  })

  it('transmits the value of an orchestratorVisible field, proving it can see values at all', () => {
    const visible = ALL_FIELDS.filter(
      (d) => (d as { orchestratorVisible?: boolean }).orchestratorVisible === true,
    )
    // If this is ever zero, the test above is vacuous and must be rewritten.
    expect(visible.length).toBeGreaterThan(0)
    for (const def of visible) {
      expect(payload, `never sent ${def.id}`).toContain(valueFor(def.id))
    }
  })

  it('carries the field identifiers, so the payload is not simply empty', () => {
    for (const def of ALL_FIELDS.slice(0, 5)) {
      expect(payload).toContain(def.id)
    }
  })
})
```

The second and third cases are not optional. They are what stop the first from passing because the capture was empty or the payload was blank — the exact vacuous-test failure mode this codebase has already hit three separate ways.

- [ ] **Step 2: Run and confirm it passes**

Run: `npx vitest run tests/integration/pii-boundary.test.ts` → PASS

- [ ] **Step 3: Sabotage check, twice**

1. In `view.ts`, set `visible` to `true` unconditionally. Confirm the first test goes red **naming a specific sensitive field id**, not just failing.
2. Make the stub capture nothing (return an empty object). Confirm the **second** test goes red. If it does not, the first test is passing vacuously and both must be fixed before this task is done.

Revert both.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/pii-boundary.test.ts
git commit -m "test(pii): prove no field value reaches the model payload"
```

---

### Task 14: The conversational shell

**Files:**
- Create: `src/ui/chat/ConversationShell.tsx`, `src/ui/chat/TurnView.tsx`, `src/ui/chat/blocks.tsx`, `src/ui/client/useConversation.ts`
- Test: `tests/ui/chat/conversation.test.tsx`

**Interfaces:**
- Consumes: `Turn`, `Block`, `vettedCopy`, `fieldDef`, and the existing `FieldControl`/`Rationale`/`DocumentUpload` components.
- Produces: `<ConversationShell applicationId state onProfileChange />`.

- [ ] **Step 1: Write the failing test**

Cover: the opening beat renders before any turn exists and without a model call; a `field_ask` block renders the field's real input control and its vetted rationale; a `rationale` block renders `purpose` and authority verbatim; a `notice` block renders its vetted string; agent voice renders when present and nothing renders in its place when null; keystrokes in a `field_ask` control go to the panel's handler and **not** through any turn request.

The last one is the §4 guarantee at the UI layer. Assert it by spying on the turn endpoint and confirming it is not called on input.

- [ ] **Step 2: Run and confirm it fails for the right reason**

- [ ] **Step 3: Implement**

`blocks.tsx` is a discriminated switch over `Block['kind']`, reusing existing panel components rather than new inputs — a second input path is a second place values can go. The opening beat renders from `vettedCopy('opening_beat')` with no turn and no fetch.

Follow the existing panel's styling via `@/ui/theme/tokens`. Streaming panel fills use a polite live region with coalesced announcements, and focus is never stolen by an update (§9.1 of the parent spec).

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Verify in a real browser**

Run `npm run dev`. Load the app. Confirm the opening beat renders, a turn arrives, and a field typed in the transcript lands in the panel. **This step is not optional:** a store bug invisible to 649 tests was found in Phase 2 only by running the app, because Next bundles each route separately.

- [ ] **Step 6: Commit**

```bash
git add src/ui/chat src/ui/client/useConversation.ts tests/ui/chat
git commit -m "feat(ui): render the conversation beside the panel"
```

---

### Task 15: Retire ProfileControls

**Files:**
- Delete: `src/ui/demo/ProfileControls.tsx`
- Modify: `src/app/page.tsx`
- Test: modify `tests/integration/page-upload.test.tsx` and any other test that drives `ProfileControls`

**Interfaces:** consumes Task 14's shell.

- [ ] **Step 1: Find every reference**

```bash
grep -rn "ProfileControls" src tests
```

Each hit is a test that established a profile by clicking the demo widget. Each must now establish it via a `setProfile` turn or by seeding state directly — decide per test, preferring direct seeding for tests that are not about the agent.

- [ ] **Step 2: Render profile answers as panel rows**

The profile's current answers must remain visible and editable, so a mistaken answer is corrected the same way every other answer is. Add a profile section to `ApplicationPanel` driven by `app.updateProfile`.

- [ ] **Step 3: Delete the component and its import**

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck && npm run build` → all clean.

- [ ] **Step 5: Verify in a real browser**

Confirm a full registration is completable with no demo controls present: the agent asks, the panel accepts, submission works.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(ui): let the agent establish the profile"
```

---

### Task 16: Automation-bias guards

**Files:**
- Modify: `src/domain/field-def.ts`, `src/domain/catalog/{address,identity,tax}.ts`, `src/ui/chat/blocks.tsx`
- Test: `tests/domain/catalog/bulk-confirm.test.ts`, extend `tests/ui/chat/conversation.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { fieldDef } from '@/domain/catalog'

/**
 * There is no bulk-confirm affordance today — confirmation is per-row. This
 * pins the flag so that when one is built it cannot include these three.
 */
describe('fields that may never be bulk-confirmed', () => {
  const NEVER = ['addr_line1', 'addr_city', 'addr_state', 'addr_zip',
                 'first_name', 'last_name', 'tax_id'] as const

  it.each(NEVER)('%s is marked neverBulkConfirm', (id) => {
    expect(fieldDef(id).neverBulkConfirm).toBe(true)
  })
})
```

Plus a UI test: a `field_ask` for an address whose provenance source is `'ocr'` renders the `address_still_current` question, and one for an empty address does not.

- [ ] **Step 2: Run and confirm it fails for the right reason**

- [ ] **Step 3: Implement**

Add `neverBulkConfirm?: boolean` to `FieldDefBase` in `field-def.ts`. Set it on the seven ids above. In `blocks.tsx`, when rendering a `field_ask` for a field whose current provenance is `source: 'ocr'` and which is an address field, render `vettedCopy('address_still_current')` above the control with equal-weight affirm and change options.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Sabotage check**

Remove `neverBulkConfirm` from `tax_id`. Confirm the parameterised test goes red naming `tax_id`. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/domain src/ui/chat tests
git commit -m "feat(catalog): mark the fields no bulk confirmation may include"
```

---

### Task 17: Degraded mode, resume, and spec corrections

**Files:**
- Test: `tests/integration/degraded-mode.test.ts`, `tests/integration/resume.test.ts`
- Modify: `docs/superpowers/specs/2026-08-01-iaa-genui-registration-design.md`

- [ ] **Step 1: Write the degraded-mode test**

A full registration — profile through submission — with the model stubbed to throw on every call. Assert the final state is indistinguishable from one driven with the agent working: same fields, same statuses, `submittedAt` set. Assert the transcript contains `degraded_notice` turns and that the panel path wrote every value.

This is the §11.1 resilience proof. It must drive the real route handlers, not a mock of them.

- [ ] **Step 2: Write the resume test**

An application with a transcript and some fields settled. On the first turn of a resumed session, assert an `orientation` block with correct `done`/`total`, and assert the client lands on the panel rather than replaying the transcript.

- [ ] **Step 3: Run both and confirm they fail, then pass**

- [ ] **Step 4: Correct the parent spec**

In `docs/superpowers/specs/2026-08-01-iaa-genui-registration-design.md`:
- §8: change "AI SDK v5" to "AI SDK 7", since the package is at 7 and the phrase would otherwise send the next reader to a two-major-version-old API.
- §15: add **Phase 6 — voice interaction.** Spoken input and output. Deferred from Phase 3; the turn structure keeps vetted copy as discrete blocks so it can be spoken without restructuring, and the §8.1 boundary must be redesigned before microphone input is accepted, because a spoken taxpayer ID leaves the network as audio.

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck && npm run build`. Record the test count.

- [ ] **Step 6: Verify the whole phase in a real browser**

Complete one registration end to end with the live model (`ORCHESTRATOR_PROVIDER=local ORCHESTRATOR_ENDPOINT=http://192.168.1.11:1234 ORCHESTRATOR_MODEL=...`). Then complete a second with the model deliberately unreachable. Both must reach submission.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(orchestrator): prove the panel alone completes a registration"
```

---

## Definition of done

- [ ] `npm test`, `npm run typecheck`, `npm run build` all clean
- [ ] `tests/domain/purity.test.ts` passes — no `ai` or `@ai-sdk/*` import reached `src/domain/`
- [ ] The PII boundary test passes **and** its companion positive test proves it can see values at all
- [ ] Every task's sabotage checks were run and observed to fail on the named assertion
- [ ] A full registration completes in a real browser with the model live, and again with it unreachable
- [ ] `ProfileControls` is gone and nothing references it
- [ ] No host, port or model id is hardcoded; `grep -rn "192.168\|localhost:1234\|claude-opus" src` returns nothing
