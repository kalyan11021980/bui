# Phase 3 — the conversational agent

**Date:** 2026-08-03
**Implements:** `2026-08-01-iaa-genui-registration-design.md` §6.1, §7, §8–8.2, §10.1, §10.4, §11.1, §12.1, §13
**Depends on:** Phase 1 (requirements engine, application state, audit log, panel) and
Phase 2 (OCR, provenance), both merged.

## 1. What this phase delivers

An applicant is met by an agent that introduces itself, establishes their profile in
conversation, and asks for what the requirements engine says is outstanding — framing each
ask in its own voice while every legally operative word comes from the catalog. The panel
remains the sole path values travel, and remains sufficient on its own.

Goal 5 of the parent design is discharged here. Nothing else in the product changes.

## 2. Decisions taken before design

| Decision | Choice |
|---|---|
| Model target | One interface, provider chosen by env. Local by default, hosted swappable. |
| Profile intake | The agent asks. `ProfileControls` is deleted. |
| Where values go | Panel only. The chat carries intent, never data. |
| Voice delivery | Buffered server-side, linted, then sent. No token streaming. |
| Framework | Vercel AI SDK 7. |
| Spoken voice | Out of scope. Recorded as Phase 6. |

### 2.1 On the framework

`ai@7` with `@ai-sdk/anthropic@4` and `@ai-sdk/openai-compatible@3`. Verified against the
installed typings rather than recalled: `generateText` defaults to `stopWhen:
isStepCount(1)`, so a turn is one model call and no agentic loop — the shape this design
wants, as the default rather than as configuration. `activeTools` narrows the offered tool
set per turn. `AnthropicProviderOptions` carries `effort` and `thinking`.

LangGraph and Mastra were rejected for the same reason: both want to own graph state and
checkpointing, and this application's state *is* its compliance surface — a tested
reducer, an append-only log, and a pure requirements engine. `assistant-ui` was rejected
because the shell renders vetted blocks with panel-owned inputs and no streaming, which is
not the shape it assumes. XState was rejected as redundant with `application/reducer.ts`.

The parent spec §8 says "AI SDK v5"; the package is at 7. That line is corrected as part
of this phase.

## 3. Module layout

```
src/domain/orchestrator/
  tools.ts         the agent's entire vocabulary, as Zod schemas
  view.ts          ApplicationState → OrchestratorView. The redaction boundary.
  voice-lint.ts    §7 rule 3. Pure function, no model, no state.
  transcript.ts    Turn and Block types
src/server/orchestrator/
  service.ts       turn(): view + intent → Turn
  model.ts         env-selected LanguageModel. The only file naming a provider.
  guard.ts         tool call → Action, or a typed rejection
  prompt.ts        system prompt assembly
src/app/api/application/[id]/turn/route.ts
src/ui/chat/       ConversationShell, TurnView, block components
```

Split along the same lines as `services/ocr/`: a pure domain half with no I/O and a server
half that talks to the world. `model.ts` is small because the SDK *is* the adapter.

---

## 4. The PII boundary

**Rule: the orchestrator receives field identifiers, statuses, confidence and metadata. It
never receives field values.** The exception is `orchestratorVisible`, which allowlists
non-sensitive display values so the agent can stay warm without leaking anything material.

### 4.1 The view

```ts
export type FieldView = {
  id: RequirementKey
  /** Catalog label, vetted. Safe: it names the field, not the answer. */
  label: string
  status: FieldStatus
  sensitive: boolean
  /** Present when the field carries provenance. Metadata, not content. */
  source?: ProvenanceSource
  confidence?: number
  /**
   * ONLY when the catalog marks the field orchestratorVisible. Rendered to a
   * string at the boundary — the model has no use for the typed value, and a
   * single string type keeps the redaction test's substring scan total.
   */
  value?: string
}

export type OrchestratorView = {
  applicationId: string
  profile: ApplicantProfile
  outstanding: readonly FieldView[]
  /** Fields already satisfied — the agent needs to know not to re-ask. */
  settled: readonly FieldView[]
  documentsOutstanding: readonly DocType[]
  submitted: boolean
  rulesVersion: number
}
```

The profile crosses in the clear. That follows the audit log's own reasoning, which records
`patch` unredacted because nothing in a profile is sensitive: applicant type, country,
state, licence classes held, GSA interest, ID form.

### 4.1.1 Conversation history

A turn needs prior context, and that context must cross the same boundary. `service.ts`
builds the `messages` array from `state.transcript` (§8.2), rendering each turn as:

- **agent turns** — the linted `voice` string, plus a flat description of each block by
  identifier (*"asked for: legal_name, date_of_birth"*). Never the resolved vetted copy,
  which would bloat every turn's prefix for no gain, and never a value.
- **applicant turns** — the `text` they typed.

Applicant text is the one place a value could enter model context, and only if the
applicant types one into the chat despite the composer being for intent. The redaction
boundary cannot detect that — a name typed into a chat box is indistinguishable from a name
mentioned in passing. §10.3 of the parent spec already owns the resulting retention
question; what this design guarantees is that no value the *system* holds is ever
transmitted, and that the chat is never the path by which a value is captured.

The system prompt is assembled once from static content and placed first, so it is a stable
cacheable prefix; the view and history follow it.

### 4.2 Enforcement

`toOrchestratorView(state)` is the only function on the model path that reads
`ApplicationState`. `service.ts` accepts an `OrchestratorView` and nothing else — the full
state is not in scope at the call site, so leaking a value requires editing the boundary
function rather than forgetting a redaction at a use site.

`value` is populated by exactly one branch:

```ts
const def = fieldDef(parseReqKey(id).fieldId)
const visible = def.sensitive !== true && def.orchestratorVisible === true
```

Read positively, and requiring `sensitive` to be explicitly not-true. A field whose
catalog entry cannot be resolved throws, the way `AuditLog.append` already fails closed on
an unrecognised id: not knowing whether a field is sensitive is a reason to refuse, never
to assume it is not.

### 4.3 The test that matters most

Highest priority in the suite, per §13. It asserts **absence**, which means it must
inspect the real outbound payload rather than the view:

1. Build states covering every catalog field, each with a distinctive generated value,
   across profile permutations and every `FieldStatus`.
2. Call the route with a stub provider that **captures** the request the SDK would send —
   system prompt, messages, and serialised tool schemas — and returns a fixed turn.
3. Assert no value of any field lacking `orchestratorVisible` appears anywhere in the
   captured payload, as a substring of the whole serialised request.
4. Assert the same for every `sensitive` field's metadata beyond `id`/`label`/`status`.

Sabotage check, and it must fail loudly with a read-back: add `value` to a sensitive field
inside `toOrchestratorView` and confirm the test goes red naming that field. A mutation
that silently fails to apply is indistinguishable from a test that cannot fail, and this
phase's predecessor shipped ten of those.

---

## 5. Tool surface

The tools are the entirety of the agent's authority. Anything absent here it cannot do,
regardless of what it emits.

| Tool | Input | Effect when accepted |
|---|---|---|
| `askFor` | `{ fieldIds: string[] }` (1–4) | Renders an input block per field, each with its vetted rationale |
| `explain` | `{ fieldId: string }` | Renders that field's vetted `purpose`/`authority`/`consequence`/`handling` verbatim |
| `setProfile` | `{ patch }` | Emits `UPDATE_PROFILE` |
| `requestDocument` | `{ docType }` | Renders the upload control for that document |
| `orient` | `{}` | Renders the §12.1 resume line from counts the server computes |

No tool has an `execute`. The SDK returns the calls, and `guard.ts` decides.

### 5.1 What is deliberately absent, and why

- **Setting a field value.** The agent has no values to set — §4 makes this structural
  rather than a rule it is asked to follow.
- **`CONFIRM`.** §10.2: confirmation is the applicant's act, and an attestation is a
  further deliberate one. Neither is an agent's to perform.
- **`SUBMIT`.** §8.2. The route refuses it while anything is outstanding, and the agent has
  no reason to hold the pen even when nothing is.
- **`VERIFY` / `REJECT`.** A human reviewer's, in Phase 4.
- **Free-form question asking.** A question outside the vetted set is voice, and voice
  cannot ask for data — it can only frame an `askFor`.

### 5.2 `activeTools` narrows the offer

Beyond validating what comes back, the turn only offers what is currently legal:

| Tool | Offered when |
|---|---|
| `setProfile` | The profile is incomplete, or the applicant's message plausibly revises it |
| `requestDocument` | `documentsToUpload(profile)` has an entry not yet uploaded |
| `askFor` | `outstandingFields(state)` is non-empty |
| `explain` | Any field is outstanding or settled — i.e. always, before submission |
| `orient` | First turn of a resumed application |

Defence in depth, not the defence. The guard runs regardless — `activeTools` shapes a
cooperative model's choices, and the guard handles an uncooperative one.

---

## 6. Invariant enforcement

`guard.ts` maps each returned tool call to an `Action`, or to a typed rejection. It is a
pure function of `(toolCall, ApplicationState)` and is tested against the route handler,
never against the prompt.

### 6.1 Rejection cases, exhaustively

| Tool | Rejected when | Reason code |
|---|---|---|
| `askFor` | `fieldIds` is empty, or longer than 4 | `ask_cardinality` |
| `askFor` | any id ∉ `outstandingFields(state)` | `field_not_outstanding` |
| `askFor` | any id fails `parseReqKey`, or names no catalog field | `unknown_field` |
| `askFor` | ids contain a duplicate | `duplicate_field` |
| `explain` | id ∉ `outstandingFields(state)` ∪ settled fields | `unknown_field` |
| `setProfile` | `patch` fails the existing `profilePatch` schema | `malformed_patch` |
| `setProfile` | `patch` is empty after parsing | `empty_patch` |
| `requestDocument` | `docType` ∉ `documentsToUpload(profile)` | `document_not_required` |
| `requestDocument` | that document is already uploaded | `document_already_held` |
| *any* | `state.submittedAt !== null` | `application_closed` |
| *any* | tool name outside the five | `unknown_tool` |

`askFor` is validated as a unit: one bad id rejects the whole call rather than silently
asking for the subset that passed. A partial ask is a different question from the one the
model asked, and the transcript would record something that never happened.

`setProfile` reuses `profilePatch` from `action-schema.ts` rather than a second copy —
the same schema the panel's writes go through. Phase 2 lost proof-of-residency for a whole
task to exactly this kind of drift.

### 6.2 What a rejection does

- The offending call is dropped. Other calls in the same turn, if valid, still apply.
- An audit event records the rejection with its reason code.
- If nothing survives, the turn renders vetted fallback copy — *"Let's keep going with
  what's left."* — plus an `askFor` the **server** constructs from the first outstanding
  field. The applicant is never shown a model error, and the flow never stalls.
- Rejections are counted on the application record, not in memory, so the count survives a
  reload and cannot be reset by opening a new tab. The third rejection on one application
  drops it to panel-only and says so in vetted copy.

### 6.3 Tests

Every row of the 6.1 table gets a case, driven through `POST /turn` with a stub provider
emitting the offending call. Each asserts three things, because asserting only the first
is how a test that cannot fail gets written:

1. the response contains no block derived from the rejected call,
2. the application state is byte-identical to before the turn,
3. an audit event exists with the expected reason code.

---

## 7. Copy tiers

Two tiers, per §7 of the parent spec. **Voice** is model-generated and confined to a
preamble slot. **Vetted** is every label, rationale, attestation and consequence, rendered
verbatim from the catalog.

### 7.1 The lint

`lintVoice(text): { ok: true } | { ok: false; violation: VoiceViolation }` rejects on:

| Violation | Detects |
|---|---|
| `numeral` | any Unicode decimal digit, and spelled-out counts in a small closed list |
| `percentage` | `%`, `percent`, `per cent` |
| `statute` | `§`, `U.S.C.`, `USC`, `C.F.R.`, `CFR`, `IRC`, `Title \d+` |
| `legal_claim` | a vetted phrase list: *required by law*, *you must*, *you are liable*, *penalty*, *under oath*, *we are required to* |
| `length` | over 240 characters — voice is a preamble, not a paragraph |

Table-driven, with the sabotage check inverted: for each rule, a string that should pass
and a string that should fail, and a mutation test that removing the rule turns the
failing case green.

### 7.2 Suppression

Independently of the lint, the voice slot is disabled outright when the turn's `askFor`
includes any field with `sensitive: true` (§7 rule 2). Only vetted copy renders.

### 7.3 On violation

The voice is dropped. Vetted copy renders alone — the turn is still useful, because the
vetted half is the half that does the work. The turn records `voiceDropped: 'lint' |
'sensitive'`, and an audit event carries the violation kind. Never the offending text: it
is model output about a field, and the log is a compliance artefact.

---

## 8. Transcript and audit

### 8.1 Types

```ts
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
  /** Empty for applicant turns. */
  blocks: readonly Block[]
  /** Applicant turns only: what they typed. Intent, never data. */
  text?: string
}
```

Blocks carry **identifiers, not copy**. The rendered string is resolved from the catalog at
render time, so the transcript cannot drift from the vetted source, and a copy revision
does not silently rewrite history — that is what the copy hash is for.

`VettedCopyId` is a new closed union naming each fixed string this phase introduces: the
opening beat, the fallback line, the degraded-mode notice, the panel-only notice.

### 8.2 Persistence

`ApplicationState` gains `transcript: readonly Turn[]`. It lives with the application in
`store.ts` for the same reason the fields do: one record, one serialised stream of
mutations, no second store to fall out of step. `Turn.seq` counts within the application.

An `APPEND_TURN` action is added to the `Action` union and to `actionSchema`, so turns
travel the same validated path as every other mutation and the reducer stays the only
writer. The reducer refuses `APPEND_TURN` once `submittedAt` is set, matching every other
action.

### 8.3 Audit

`AuditKind` gains **two** kinds, `'agent_turn'` and `'applicant_message'`, because a turn
has a `role` and one event kind covering both would misname half of them. A turn is not a
state mutation of a field, so neither goes through `AuditLog.append(applicationId, action)`
— that function's contract is `Action`, and widening it would put a non-field event down a
path built around `fieldId` and `value`. Instead:

```ts
appendTurn(applicationId: string, turn: Turn): AuditEvent
```

which selects the kind from `turn.role`, and adds these optional fields to `AuditEvent`
(all absent on an `applicant_message` except `turnSeq`):

| Field | Meaning |
|---|---|
| `turnSeq` | the `Turn.seq` this event records |
| `shownCopyHash` | hash of what was rendered: block ids + the resolved vetted strings + their version |
| `voiceDropped` | present when the voice slot was suppressed or linted away |
| `rejections` | reason codes for tool calls the guard refused this turn |

`shownCopyHash` reuses the existing `Digester`. §10.1 requires a hash of what the user was
shown at the moment they confirmed; this extends the same guarantee to what the agent
showed them on the way there, which is the half currently missing.

The agent's voice text is **not** written to the audit log. It is not legally operative by
construction — that is the whole point of the tiers — and writing model prose into a
compliance artefact invites it being read as though it were.

### 8.4 Tests

- Every turn produces exactly one audit event, of the kind matching its `role`, and `seq`
  is gapless per application.
- The copy hash changes when a vetted string changes and is stable when it does not.
- A dropped voice is recorded with its cause.
- Guard rejections appear in `rejections` with the codes from 6.1.
- `APPEND_TURN` after `SUBMIT` is refused, like every other post-submission action.

---

## 9. Opening beat and profile intake

The opening beat is fixed copy, rendered before any model call — §6.1 quotes it verbatim
and it is a `notice` block with its own `VettedCopyId`. No turn is generated to produce it,
so a cold or unreachable model does not cost the applicant the introduction.

The agent then establishes the profile conversationally via `setProfile`.
`src/ui/demo/ProfileControls.tsx` is deleted along with its use in `page.tsx`; the
profile's current answers render as ordinary editable panel rows, so a mistake is corrected
the same way every other answer is.

## 10. Degraded mode

The conversational shell is strictly additive. `useApplication` is unchanged, and the panel
does not know the agent exists.

When `POST /turn` fails, times out, or the provider is unreachable: a vetted notice renders
in the transcript, the composer disables, and the panel continues to present outstanding
fields with the same vetted rationale. No retry storm, no spinner without end.

The proof is an end-to-end test that completes an entire registration — profile through
submission — with the provider stubbed to throw on every call, asserting the resulting
state is indistinguishable from one driven with the agent working.

## 11. Automation bias

§10.4 requires that address, legal name and taxpayer ID are never bulk-confirmed, and that
the agent asks whether a licence address is still current rather than presenting it as
fact.

**Stated honestly: there is no bulk-confirm affordance in the product today.** Confirmation
is per-row in `FieldRow.tsx`. So the first half of §10.4 currently constrains nothing. This
phase adds an optional `neverBulkConfirm?: boolean` to `FieldDefBase`, sets it on those
three catalog entries, and pins it with a test — so that when a bulk affordance is built it
cannot include them. A guard placed before the thing it guards, deliberately, and recorded
here so nobody later mistakes the flag for evidence that bulk confirmation was considered
in the UI and handled.

The live deliverable is the second half: when an address arrives with `source: 'ocr'`, the
ask renders a vetted question — *"Is this still the address you want on file?"* — with
equal-weight affirm and change options. Vetted copy, not voice. Tested by asserting the
block that renders for an OCR-derived address differs from the one for an empty field.

## 12. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ORCHESTRATOR_PROVIDER` | `local` | `local` or `anthropic` |
| `ORCHESTRATOR_ENDPOINT` | — | Base URL, required when `local` |
| `ORCHESTRATOR_MODEL` | — | Model id, required |
| `ORCHESTRATOR_EFFORT` | `low` | `AnthropicProviderOptions.effort`. Ignored when `local` — an OpenAI-compatible endpoint has no equivalent, and `model.ts` says so rather than passing an option the provider silently drops. |
| `ANTHROPIC_API_KEY` | — | Required when `anthropic` |

No host, port or model id is hardcoded anywhere. `model.ts` throws at startup on a missing
required variable rather than at the first applicant's first turn. The test suite never
requires a reachable model: every test supplies a stub provider.

## 13. Test plan

Beyond the per-section tests above:

| Area | Assertion |
|---|---|
| PII boundary | §4.3. Highest priority in the suite. |
| Guard | Every row of §6.1, through the route. |
| Voice lint | Table-driven, each rule independently mutation-checked. |
| Copy tiers | No model-generated string reaches the DOM for a sensitive or compliance field. |
| Transcript | Gapless `seq`; copy hash stable and sensitive; refused after submission. |
| Degraded | Full registration completes with the provider throwing. |
| Resume | A returning applicant lands on the panel with an orientation line, not a replayed transcript. |
| Tool offer | `activeTools` excludes each tool under the conditions in §5.2. |

**Every implementer is briefed to audit supplied tests before writing code.** Ten of
fifteen Phase 2 task briefs shipped at least one test that could not fail, and every one
was caught by a person rather than by the suite. Each test that claims to catch a
regression must be accompanied by a sabotage check that fails loudly, with a read-back
naming what went red.

## 14. Out of scope

- **Voice interaction (speech).** Recorded as Phase 6 in the parent spec §15. Turn blocks
  are discrete vetted units precisely so they can be spoken later without restructuring;
  nothing here forecloses it.
- **Streaming.** Follows from the buffered-lint decision. Revisit only if a lint that can
  operate on a partial string is found, which is not obviously possible for the statute and
  numeral rules.
- **Review lifecycle, signing.** Phases 4 and 5, unchanged.

## 15. Risks

| Risk | Mitigation |
|---|---|
| A local model handles multi-tool turns badly, so rejections are frequent | Guard degrades gracefully (§6.2); three rejections drop to panel-only; `activeTools` narrows the offer |
| Buffered turns feel slow | `effort: low`, and the panel never blocks on a turn |
| The lint rejects benign voice and the agent reads flat | Violations are logged with their kind, so the rules can be tuned against real output rather than guessed at |
| The transcript grows unbounded | Bounded in practice by ~70 fields; revisit if a real application exceeds a few hundred turns |
