# Phase 3 closeout — the conversational agent

**Date:** 2026-08-04
**Branch:** `phase-3-agent`, 42 commits
**Design:** `2026-08-03-phase-3-agent-design.md` · **Plan:** `2026-08-03-phase-3-agent.md`

## What works

An applicant talks to an agent that establishes their profile, asks for what the
requirements engine says is outstanding, and explains why — while every legally operative
word comes from the vetted catalog and no field value ever enters a model context.

Verified in a browser against a live model (Ollama `glm-5.2`) and live `deepseek-ocr`, not
only in tests:

- **Profile intake drives the engine.** "I'm a business, a licensed dealer in Ohio, and I
  want GSA lots too" set all four facts; a dealer-licence upload appeared and Ohio's
  out-of-state buyer form entered scope, in the browser.
- **Copy tiers hold under pressure.** Asked why the taxpayer ID was needed, the agent
  rendered the catalog's purpose, authority, destination, consequence and handling
  verbatim — and its own voice was **entirely absent**, because the turn touched a
  sensitive field.
- **The panel is the only path values travel.** A value typed into the chat's rendered
  control landed in the panel. The turn request body is `{ text }` and nothing else.
- **OCR still works underneath.** A real licence photo filled 9 fields with provenance
  crops, and the OCR-derived address rendered "Is this still the address you want on
  file?" with equal-weight options rather than presenting itself as settled.
- **The agent is not a single point of failure.** With no model configured, the opening
  beat still rendered, a send produced the vetted degraded notice, and the application
  remained completable through the panel alone.

925 tests. No test requires a reachable model.

## The model adapter

`ORCHESTRATOR_PROVIDER` selects `local` (any OpenAI-compatible endpoint) or `anthropic`.
Confirmed working against Ollama with zero code change. On Ollama specifically:
`glm-5.2:cloud` and `minimax-m3:cloud` work; `kimi-k3:cloud` returns an empty-balance
error. LM Studio at `192.168.1.11:1234` also serves a local chat model alongside
`deepseek-ocr`, which suits the PII posture better than any cloud model.

## Rulings taken

**`setProfile` may shrink the required set — accepted and shipped.** The agent's
`setProfile` is the one accepted path that changes what the engine requires, so a model
asserting `{licenses: []}` or `{addressDiffersFromId: false}` removes obligations and
`SUBMIT` then passes. No rejection code covers it. Accepted because the compensating
controls are real: the patch is audited unredacted, the profile stays visible and
correctable in the panel, and the client adopts the new state so the panel visibly
changes. Ticketed below.

**Audit turns through the one write path.** The design originally gave `AuditLog` a
separate `appendTurn`. That reasoning expired once appending a turn became an `Action`
committing through `applyAction → commit() → log.append` like every other one — a second
append call would have written two events per turn. Turn content now lives in `append`'s
per-kind branches. Spec §8.3 records the reversal.

## Open, and why each is open

**1. The audit trail is complete about actions and thin about what was shown.**
`shownCopyMaterial` hashes a `field_ask` as `ask:<fieldId>:<label>`, but the UI renders the
field's `purpose`, `authority`, `destination`, `consequence` and `handling`. Edit
`tax_id.purpose` and every previously recorded `shownCopyHash` stays byte-identical. A
compliance reader asking "what were they told when we asked for their SSN?" recovers the
label and nothing else. This is the highest-value item here.

**2. The attestation hash is a hardcoded literal.** `useApplication` stamps
`shownCopyHash: 'catalog-v1'`. Pre-existing, but Task 16 made it load-bearing: an OCR
address affirmed after seeing "Is this still current?" produces an audit event
byte-identical to one confirmed via the panel's "Looks right" — same kind, same field, same
literal, no turn reference. The automation-bias guard leaves no evidence it fired.

**3. `setProfile` narrowing has no control.** Per the ruling above. Either refuse a patch
that only shrinks, or render an explicit vetted notice on a narrowing patch so it can never
be silent — `setProfile` currently renders no block at all.

**4. Rejection codes misdescribe schema-parse failures.** An `askFor` whose payload is
malformed is reported as `ask_cardinality`; `explain` as `unknown_field`. These land in
`Turn.rejections` and the audit event, so the record misstates why a call was refused. Add
a `malformed_call` code.

**5. §12.1 resume is unreachable in production.** `turn/route.ts` hardcodes
`isResume: false`, so `orient` never enters the active tool set, and no client path loads
an existing application. The mechanics are tested and correct; nothing can reach them.
Phase 4.

**6. `POST /documents` returns 500 when OCR config is missing** instead of degrading to
manual entry as §11's ladder requires. Pre-existing Phase 2 code. The orchestrator path
handles the same case correctly.

**7. The degraded-turn log has no regression test.** Reverting the one `console.error`
leaves all 925 tests green — inconsistent with the two findings beside it, which are
sabotage-verified. Parked deliberately; worth picking up early given this project's history
with mutations that silently no-op.

**8. Smaller:** `ORCHESTRATOR_EFFORT` is an unvalidated string typed as a provider enum;
`application-service.ts` is 274 lines with two reasons to change and imports `ai`;
`ORCHESTRATOR_ENDPOINT` with a trailing slash yields `//v1`; the chat's
`document_request → OCR` path has no automated coverage; the transcript replayed to the
model is unbounded by construction.

## What this phase learned about its own planning

Eighteen tasks, of which **eleven needed a fix round — and six of those were defects in the
plan, not the implementation**: a lint precedence no test data could satisfy, an audit
design whose rationale expired, `orient` arithmetic that double-counted onto a hashed
record, a fallback condition that let a turn end on a blank screen, assertions that could
not distinguish "correctly withheld" from "never offered at all", and — in the suite's most
important test — a fixture that routed every field down a path which stripped the values
the test claimed to check.

The countermeasure that worked was adding one instruction to every dispatch: *audit the
brief's supplied tests before trusting them, and report what you changed.* The three
implementers after that change each found a real defect in the supplied tests before
writing any of their own.

The reviews earned their cost most sharply on the turn route, where a reviewer found that
`applyTurn` held application state across the model call and wrote it back unconditionally
— a panel edit or a submit landing during those seconds would have been silently
discarded, including un-setting `submittedAt` while the audit log still recorded the
submission.
