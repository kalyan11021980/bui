# IAA Buyer Registration — Agentic Conversational Redesign

**Date:** 2026-08-01
**Status:** Revised after expert review (rev 2)
**Source of truth for current UI:** `~/Desktop/iaa.docx` (10 screenshots)

---

## 1. Problem

The existing IAA buyer registration flow asks a business registrant with one license for
roughly **71 discrete inputs** across 4 steppers and 2 different UI paradigms:

| Screen | Inputs |
|---|---|
| Complete your profile | 6 |
| Identification + contact | 12 |
| ID upload + address + phones | 14 |
| Business + address | 14 |
| License information | 10 (× N licenses) |
| GSA | 2 |
| Bidding eligibility | 1 |
| DocuSign W-9 | ~12 |

The count is not the real problem. The **redundancy** is:

- Address is entered three times (personal, business, W-9)
- Legal name three times (identification, business legal name, W-9 line 1)
- Six phone slots, one of which (mobile) was already collected on screen 1
- Six M/D/Y dropdown triplets = 18 select interactions for 6 dates
- State asked on screen 1, again in identification, again in address, again in business
- The driver's license scan already contains name, DOB, DL number, expiry, address and
  state — yet "Enter Manually" is offered as an equal peer to uploading

**Roughly 30 of the 71 inputs are duplicates or derivable** from one document scan plus an
address lookup.

Two further defects:

- The 24-hour human review is disclosed on the **final screen**, after all work is done.
- There is no repair path. A rejected document means re-entering the flow with no
  indication of what specifically failed.

## 2. Goals

1. Reduce perceived effort — the user should gain momentum while providing information.
2. Collect every legally required input. No reduction in compliance coverage.
3. **Every ask carries its own rationale.** The user always knows what a field is for and
   why it is needed.
4. Set expectations about human review up front, not at the end.
5. **Fully agentic and conversational.** An agent drives the entire flow from first
   contact, including the introduction. Interactive throughout.

## 3. Non-goals

- Free-form LLM-authored UI. The agent selects from vetted components and never authors
  fields or legally operative copy.
- Replacing DocuSign.
- Changing what is legally required.

## 4. Constraints

| Constraint | Decision |
|---|---|
| Runtime | Next.js (full-stack, route handlers) |
| Model access | **AI SDK v5 only.** No vendor SDKs. Any model swappable underneath. |
| OCR | DeepSeek-OCR (MLX) via LM Studio for development; production target decided at §13.1 gate |
| Services | Small modular services with real interfaces, not fakes |
| Visual | Must follow existing IAA colors and guidelines |
| Human review | Retained. Must be communicated, with status and a repair loop. |
| Modality | Agent-led conversation is the primary path, not an enhancement |

## 5. Expected reduction — honest accounting

The earlier claim of "71 inputs → 12 touches" was unit-switching and is withdrawn. It
compared *inputs* against *touches* and excluded the DocuSign W-9 ceremony despite §3
declaring DocuSign unchanged.

**Honest estimate for the §1 persona (business, one license): ~20–30 interactions plus the
unchanged DocuSign ceremony.** Roughly a 2–3× reduction, not 6×.

New costs this design introduces, which must be counted against the win:

- OCR wait (seconds per document)
- Verification of machine-entered data — confirming is cognitively cheaper than typing but
  is not free
- Rationale reading, once per ask
- Conversational turn latency

The reduction comes from four deterministic mechanisms, **not from the conversation**:
OCR extraction, `carried` provenance (§9), requirements pruning, and per-field repair. The
conversation is the chosen interface to those mechanisms because it is the best vehicle for
goal 3 (rationale on every ask) and goal 5, not because it produces the savings. This
distinction must stay honest in any usability testing.

## 6. Chosen approach

**Fully agentic conversational intake.** An agent opens by introducing itself, states the
contract, and drives every subsequent step. A persistent panel fills in live alongside,
stays editable, and shows provenance.

Two alternatives were considered and rejected:

- **Deterministic review form, no LLM in the critical path.** Recommended by expert review
  as the lower-risk option. Rejected: it does not meet goal 5. The safety fixes that
  motivated it (§8, §10.1, §11) have been adopted independently, so its benefits are
  retained without abandoning the agentic modality.
- **Form that collapses as it learns.** Honest about total scope, but 71 fields on screen
  one is intimidating regardless of what happens next.

### 6.1 Opening beat

The agent introduces itself before anything else. This is fixed copy, not generated:

> **Hi — I'm your registration agent.** I'll get you set up to bid at IAA.
>
> Here's how this works. I'll ask you a few things, and wherever I can I'll fill them in
> myself from your documents so you don't have to type. I'll always tell you why I need
> something.
>
> It takes about four minutes. After that, a person on our Buyer Services team checks your
> documents — usually within 24 hours — because state law requires a human to verify
> dealer licenses.
>
> Ready? The fastest start is your driver's license. One photo fills in about eight things.

This single beat discharges goals 3, 4 and 5 before any data is requested.

## 7. Copy tiers

The agent is conversational but never authors legally operative language. Two tiers,
enforced in code:

| Tier | Content | Source | Where |
|---|---|---|---|
| **Voice** | greetings, acknowledgments, transitions, ordering, encouragement | model-generated | preamble slot only |
| **Vetted** | `purpose`, `authority`, `consequence`, `handling`, `destination`, all labels, all attestations | fixed strings from the catalog, legally signed off | everything else |

**Rules:**

1. When the agent explains why a field is needed it **renders the vetted string verbatim**.
   It may frame it (*"Sure — here's exactly why:"*) but never paraphrases it.
2. For fields with `sensitive: true` the voice slot is **disabled entirely**. Only vetted
   copy renders.
3. No model-generated string may contain a numeral, a percentage, a statute reference, or
   a conditional legal claim. Linted, not trusted.

This resolves the contradiction flagged in review: the orchestrator *selects and sequences*
rationale; it does not phrase it.

## 8. Architecture

**Governing rule: the LLM sits beside the state machine, never inside it.** It chooses what
to ask, in what order, and how to frame it. It cannot invent a field, skip a requirement,
mark an application complete, or author compliance copy.

```
┌──────────────────────────────────────────────────────┐
│  REQUIREMENTS ENGINE          (pure, deterministic)  │
│  {type, country, state, activity, licenses[]}        │
│              → required fields + rationale           │
│  ── the compliance source of truth. no LLM. ──       │
└────────────────────┬─────────────────────────────────┘
                     │ outstanding field IDs + metadata
┌────────────────────▼─────────────────────────────────┐
│  APPLICATION STATE   persistent · resumable          │
│  per field: value · status · provenance · confidence │
│  empty → derived → confirmed → verified │ rejected   │
│  + APPEND-ONLY EVENT LOG (§10.1)                     │
└──────┬──────────────────────────────────┬────────────┘
       │ metadata only (§8.1)             │
┌──────▼───────────────┐        ┌─────────▼────────────┐
│  ORCHESTRATOR        │        │  SERVICES            │
│  AI SDK v5 · tools   │◄──────►│  Ocr · Address       │
│  picks the next ask  │        │  LicenseVerify       │
│  frames it (voice)   │        │  Review · Signing    │
└──────┬───────────────┘        │  Notification        │
       │ blockId + fieldId      └──────────────────────┘
┌──────▼───────────────────────────────────────────────┐
│  BLOCK REGISTRY   vetted React components + RHF/Zod  │
└──────────────────────────────────────────────────────┘
```

### 8.1 PII boundary — the orchestrator never sees values

**Architectural rule: the orchestrator receives field IDs, statuses, confidence and
metadata. It never receives field values.** Rationale: LM Studio logs prompts to local
disk, and any hosted model swapped in later logs remotely. Taxpayer IDs, dates of birth and
license numbers must not enter a model context.

Exception, narrowly scoped: `FieldDef.orchestratorVisible?: boolean` (default `false`)
allowlists non-sensitive display values — given name, state — so the agent can stay warm
("Thanks, Kalyan — Georgia it is") without leaking anything material. `sensitive: true` and
`orchestratorVisible: true` are mutually exclusive, asserted at compile time.

Enforcement is a redaction boundary in the route handler with its own test (§13), not a
prompt instruction.

### 8.2 Invariant enforcement

Invariants live in code, not in prompts. The route handler rejects any tool call whose
`fieldId` is outside the requirements engine's current outstanding set, and rejects any
completion attempt while requirements remain. A model that misbehaves produces a rejected
tool call, not a bad application.

### 8.3 Rendering layer

An earlier recommendation of `json-render` was **reversed**. It assumed free-form UI
generation; since the agent only *selects* from a fixed block set, json-render's generality
is cost without benefit. A plain typed registry — a discriminated union of block types —
gives the same safety with far less machinery. Revisit only if free composition becomes a
genuine requirement.

### 8.4 Services

```
services/
  ocr/            index.ts (interface) · providers/{deepseek-lmstudio,deepseek-sidecar}.ts
  address/        index.ts · providers/{stub,smarty}.ts
  license-verify/ index.ts · providers/stub.ts
  review/         index.ts   ← human queue, status, rejection reasons
  signing/        index.ts · providers/docusign.ts
  notification/   index.ts
  audit/          index.ts   ← append-only event log
```

`OcrService` returns `{ fields, boxes?, confidence, imageSize }`. **`boxes` is optional** —
grounding is a DeepSeek-specific capability, and the UI must degrade gracefully to
confidence-only provenance when a provider cannot supply coordinates (§9.2). Coordinate
rescaling is contained inside the adapter.

Model access is declared in exactly one place:

```ts
const local = createOpenAICompatible({ baseURL: 'http://localhost:1234/v1' })
export const ocrModel = local('deepseek-ocr')
```

### 8.5 Rule versioning

The requirements engine is pure and deterministic, and applications are resumable — so an
application started under rules v1 and resumed after a state changes its licensing rules is
otherwise undefined. Every application records `rulesVersion`. On resume, if the version has
advanced, the engine re-evaluates: fields that are newly required are added as outstanding,
fields no longer required are retained but marked `superseded`. The user is told what
changed and why.

### 8.6 Concurrency

Panel edits, agent turns and OCR streams all mutate the same record. All mutations go
through a **single serialized stream** keyed by application ID. The chat references fields
by ID and re-renders current values rather than quoting stale ones, so the transcript can
never assert something the panel contradicts.

## 9. Data model

```ts
type FieldDef<T = unknown> = {
  id: FieldId
  label: string
  type: 'text' | 'date' | 'select' | 'phone' | 'address' | 'file' | 'taxid'

  // ── WHY: required by the type. no field ships without justification ──
  purpose: string       // "So we can pay you when your vehicle sells"
  authority: Authority  // 'IRS' | 'GA_DMV' | 'FEDERAL_KYC' | 'IAA_POLICY'
  consequence?: string  // vetted, legally reviewed. never model-generated.
  handling?: string     // "Encrypted. Never shown to other bidders."
  destination?: string  // "W-9, line 1"

  validation: ZodType<T>
  derivableFrom?: DocType[]
  sensitive?: boolean            // disables agent voice slot; forces redaction
  orchestratorVisible?: boolean  // default false. see §8.1
}
```

`purpose` and `authority` are **non-optional**. A field cannot be added without stating
what it is for and who requires it. The compiler enforces the product principle.

```ts
type FieldState<T = unknown> = {
  value: T | null          // typed via FieldDef<T>, not `unknown`
  status: 'empty' | 'derived' | 'confirmed' | 'verified' | 'rejected' | 'superseded'
  provenance?: {
    source: 'ocr' | 'user' | 'lookup' | 'carried'
    documentId?: string
    box?: [number, number, number, number]  // original-image coords; may be absent
    confidence?: number
    fromFieldId?: FieldId                    // for 'carried'
  }
  rejection?: { reason: string; at: Date }
}
```

`source: 'carried'` eliminates the triple-address problem. Address is captured once, then
carried into business address and the W-9, displayed as *"Same as the address on your ID ·
use a different one"* rather than three empty forms. Same for legal name.

### 9.1 UX rules this enables

- **Confidence drives the interface, not correctness.** High-confidence extractions
  collapse to a quiet row; low-confidence ones surface with the crop. Attention is spent
  only where the machine is unsure.
- **Sensitive fields show `handling` by default, never on hover.** Anxiety about the tax ID
  field is where people abandon. Answer it before it is asked.
- **Rejections are written for humans.** *"The photo was too dark to read your license
  number"* — never `OCR_CONFIDENCE_BELOW_THRESHOLD`. Reviewers pick from a curated list;
  free text never reaches the user raw.
- **Accessibility.** Provenance has a keyboard and screen-reader equal: focus announces
  *"Driver's license number, 123456789, read from your uploaded license, high
  confidence."* Streaming panel fills use a polite live region with coalesced
  announcements, not per-field churn (WCAG 4.1.3). Focus is never stolen by a streaming
  update. Session timeout warns and preserves a half-entered application rather than
  discarding it (WCAG 2.2.1).

### 9.2 Provenance is mobile-first

Expert review correctly identified that hover-linked provenance is a desktop interaction,
while document capture is camera-first and therefore mobile-first. The valuable half is the
**inline crop**, which works everywhere:

```
  ┆ Driver's License Number        ← dashed = read, not yet confirmed
  ┆ 123 456 789
  ┆ [crop of their license]
    from your license · [Looks right]
```

The inline crop directly beneath the field is the **primary** treatment on all viewports.
Bidirectional hover-highlighting of the full document thumbnail is a **desktop
enhancement** only. When `boxes` is unavailable the crop is omitted and provenance
degrades to a text attribution plus confidence — no layout change, no broken affordance.

## 10. Compliance

### 10.1 Audit trail

`FieldState` alone is insufficient for KYC and e-signature integrity. Every application
carries an **append-only event log**: every value set, every edit, every confirmation, every
agent turn, and a hash of **what the user was shown at the moment they confirmed**
(rendered block ID + vetted copy version). Without the last item, an attestation cannot be
reconstructed after a copy change.

Consequence: **undo is scoped to pre-submission drafts only.** ⌘Z never reverses a
confirmation of a compliance attestation; those are corrected by a new, logged event.

### 10.2 Attestation is distinct from confirmation

A chip tap reading "Looks right" is **not** a W-9 certification. IRS certification language
is prescribed verbatim and made under penalty of perjury. Attestations are a separate,
deliberate step rendering fixed legally-approved text, visually and interactively distinct
from routine field confirmation, and separately logged.

Pre-filling W-9 fields is retained, but bulk confirmation never extends to the
certification itself.

### 10.3 Required before launch

Owned by whoever owns compliance, not by engineering:

- **ESIGN/UETA consent** captured up front. DocuSign covers only its own envelope, not the
  conversational attestations preceding it.
- **OFAC / sanctions screening** — standard for auction buyer onboarding, absent from the
  current flow.
- **Retention and deletion policy** for government ID images and taxpayer IDs. `handling`
  is UX copy, not a control.
- **Adverse-action obligations** where a human rejects an applicant based on third-party
  license-registry data.
- **Sign-off on every vetted string** in the catalog (§7), and on the requirements engine's
  encoding of state licensing rules.

### 10.4 Automation-bias mitigation

Because a human reviewer verifies documents against the application — not against the
user's *intent* — a stale address OCR'd from a license and bulk-confirmed can silently
become the address of record for titles and payments. Therefore:

- Address, legal name and taxpayer ID are **never bulk-confirmed**. Each requires an
  individual, deliberate confirmation regardless of OCR confidence.
- The agent explicitly asks whether the license address is still current, rather than
  presenting it as settled fact.

## 11. Error handling

| Kind | Treatment |
|---|---|
| Validation | orange inline, immediate, non-blocking |
| OCR miss / low confidence | **not an error.** The agent asks as it would have anyway. There is no "OCR failed" state. |
| Service failure | degrade, never block |
| Human rejection | repair loop (§12) |

**Degradation ladder** — registration must complete with every service down:

| Service down | Fallback |
|---|---|
| LM Studio / OCR | manual entry, same vetted rationale copy |
| Address lookup | free-text address |
| License registry | accept and flag — a human is checking anyway |
| DocuSign | existing *"Technical Difficulties? Skip this Page"* escape hatch |
| **Orchestrator / model** | **the panel alone is sufficient.** See §11.1. |

### 11.1 The agent is not a single point of failure

Although the agent drives the experience, the application can always be completed through
the panel alone, using the same vetted rationale copy. If the model is unavailable, slow,
or the user simply prefers it, the panel presents outstanding fields directly. This is a
resilience requirement, not a competing modality — but it is also what serves returning
users and power users (§12.1).

## 12. Review lifecycle

**Expectation is set in the opening beat (§6.1)**, framed as legitimacy rather than delay.

**Status is per-item, not one opaque state:**

```
  ✓ Submitted              2:14 PM
  ✓ Documents received     2:14 PM
  ◐ Verifying your license  in progress · usually under 24h
  ○ Account activated
```

It lives as a persistent banner over inventory browsing, so the wait is spent building a
watchlist.

**Repair loop:**

```
  Your license photo needs another look
  ──────────────────────────────────────
  ┆ Georgia dealer license
  ┆ [their submitted photo, dimmed]
  ┆ "Too dark to read the license number"
  ┆                    — Buyer Services, 9:12 AM
  ┆
  ┆        [ Retake photo ]  [ Enter manually ]

  Everything else is verified. ✓ 10 of 11
```

The user lands on only what was rejected, with the reason and their original submission.
All other fields remain `verified`. Resubmission re-queues only repaired items.

### 12.1 Resume

A returning user does **not** replay the transcript. They land on the panel showing
outstanding items, with the agent offering a one-line orientation ("You're 8 of 11 done —
want me to pick up where we left off?"). Resume is panel-first by necessity; the transcript
is history, not a path.

## 13. Testing

- **Requirements engine** — heaviest coverage. Table-driven across state × applicant type ×
  license type. It is the compliance surface.
- **PII redaction boundary** — assert no field value, and no `sensitive` field metadata,
  ever appears in an outbound model payload. Highest-priority test in the suite.
- **Copy tier enforcement** — assert no model-generated string reaches the DOM for
  `sensitive` or compliance fields; assert voice-slot output contains no numerals,
  percentages or statute references.
- **Rationale completeness** — CI test asserting every `FieldDef` has non-empty `purpose`
  and `authority`. The type system catches omission; the test catches `purpose: ''`.
- **Orchestrator invariants** — cannot mark complete while requirements are outstanding;
  cannot emit a field outside the outstanding set. Tested against the route handler, not
  the prompt.
- **OCR adapter** — fixture images with recorded responses. The suite never requires
  LM Studio.
- **Coordinate rescaling** — property test that boxes map back to original-image space for
  any input size. A confidently wrong provenance crop is worse than none.
- **Repair loop** — rejecting one field leaves the other ten `verified`.
- **Audit log** — every state transition produces exactly one event; confirmation events
  capture the rendered copy hash.
- **Degraded modes** — the application completes end-to-end with the model unavailable, and
  with `boxes` absent.

### 13.1 OCR acceptance gate — blocks UI work

Before provenance UI is built, run DeepSeek-OCR against real driver's license photographs
at production capture resolution — including glare, laminate, and low light — and measure
field accuracy and box correctness. LM Studio resizes vision inputs to 500px wide, which
degrades small print and shifts grounding coordinates; small print *is* a license number.

**If accuracy or box fidelity fails at 500px, the production target becomes an `mlx-vlm`
sidecar and LM Studio is development-only.** Decide this before building the UI that
depends on it.

## 14. Known risks

| Risk | Mitigation |
|---|---|
| Conversational latency per turn frustrates users | Panel is always available and sufficient (§11.1); agent never blocks input |
| Agent phrases something legally wrong | Structurally prevented by copy tiers (§7) and tested (§13) |
| Requirements engine encodes real legal rules | Sign-off required from compliance owner (§10.3). Not a developer judgement call. |
| Automation bias on pre-filled critical fields | No bulk confirmation for address, legal name, taxpayer ID (§10.4) |
| Reduction is smaller than hoped | Honest baseline recorded in §5; measure against ~20–30, not 12 |

## 15. Implementation phases

This design is too large for one implementation plan. It decomposes into five phases, each
independently valuable and separately planned.

**Phase 1 — Deterministic core.** Field catalog with mandatory rationale, requirements
engine, application state, audit log, and the panel UI. No LLM anywhere. At the end of this
phase a user can complete a real registration through the panel, with correct per-state
requirements and full audit coverage.

**Phase 2 — OCR and provenance.** The §13.1 acceptance gate first, then `OcrService`,
inline crops, `carried` provenance, and confidence-driven display. This is where the actual
effort reduction arrives.

**Phase 3 — The agent.** Orchestrator, copy tiers, PII redaction boundary, conversational
shell, opening beat. This is the phase that delivers goal 5.

**Phase 4 — Review lifecycle.** Human review queue, per-item status timeline, repair loop,
notifications.

**Phase 5 — Signing.** DocuSign envelope prefill from collected data, embedded ceremony,
separate attestation step per §10.2.

**On the ordering.** The agent is phase 3 rather than phase 1 because it orchestrates the
requirements engine and consumes OCR output — it needs both to exist before it has anything
to drive. This is a build sequence, not a reintroduction of the rejected non-agentic
approach (§6): the agent remains the primary modality in the shipped product. Phases 1 and 2
also satisfy the §11.1 resilience requirement as a by-product, so nothing is built twice.
