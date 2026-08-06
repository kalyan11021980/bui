# Section-driven flow — grouped asks behind a Done gate

**Date:** 2026-08-05
**Amends:** `2026-08-03-phase-3-agent-design.md` (turn construction, §the fallback ask)
and the conversation shell shipped by `2026-08-05-enterprise-chat-shell-design.md`.
**Depends on:** everything merged to main at `5ef1ed2`.

## 1. What this delivers

Kaly, driving the merged product, asked for three things in one sentence: group the
questions, let the applicant say "done" per group, and have the agent produce the next
step. Today the agent asks in model-chosen batches, and advancement rides a 1.2-second
idle timer — the applicant can neither see the shape of what remains nor control the
pace.

After this phase, the conversation walks the catalog's own sections in a fixed order,
one titled group of field cards at a time, and moves exactly when the applicant says
so. The model narrates; it no longer decides what is asked or when.

## 2. Decisions taken before design

| Decision | Choice |
|---|---|
| Group driver | Catalog sections (`Section` union, `SECTION_LABEL`), in declaration order. The model never chooses grouping. |
| Advancement | A **Done with this section** button is the only advancer. The idle nudge is deleted. |
| Done with gaps | Always clickable (never disabled). With unanswered fields, the turn addresses what is missing in that section, and does not advance. |
| Planner location | Server side, deterministic. A degraded or tool-less model changes the words, never the structure. |
| Done transport | Structured intent on the turn request, committed to the transcript as an applicant turn in vetted copy — never model-interpreted text. |

## 3. The planner

`src/domain/orchestrator/plan.ts` — pure functions, no model, no state mutation:

- `SECTION_ORDER: readonly Section[]` — the `Section` union's declaration order
  (`profile` → `identification` → `address` → `contact` → `business` → `license` →
  `tax` → `gsa` → `state_forms`).
- `sectionPlan(state)` → `{ section: Section; fieldIds: readonly RequirementKey[] } | null`
  — the first section in order with outstanding fields (from `outstandingFields`),
  and every outstanding field in it; `null` when nothing is outstanding anywhere.

The current section is derived, never stored: answering fields moves the plan forward
on its own, and un-answering (a cleared field) moves it back — one consistent
definition, the same way `CompletionCard` and the fallback-notice guard already share
`outstandingFields`.

## 4. The turn

`runTurn` builds group turns from the plan instead of trusting the model's asks:

- **Blocks:** a new `section_header { section, done, total }` block followed by a
  `field_ask` per planned field. `done`/`total` count answered-vs-all fields whose
  section this is, for the frame's "2 of 4" line. The guard's vocabulary shrinks:
  `askFor` leaves the offered tool set (the planner owns asks now); `explain`,
  `setProfile`, `requestDocument`, `orient` remain.
- **Voice:** the model narrates the group (lint and sensitive-suppression unchanged).
  No tool calls required — the local model's zero-tool-call behaviour becomes the
  designed-for case, not a degraded one.
- **A Done intent with gaps** yields a turn whose blocks are the same section's
  header + its still-missing fields only, plus a vetted notice
  (`section_incomplete`) — and voice if the model offers a lintable line.
- **A Done intent on a complete section** yields the next section's group; when the
  plan is `null`, the turn is voice-only (the fallback-notice guard from `61246c5`
  already keeps it contradiction-free) and the `CompletionCard` is already on screen.
- The re-ask dedup (`already_asked`) keys per section presentation: presenting a
  section again after a gapped Done is legal; the same field twice in one group is
  not.

## 5. Done, end to end

- **UI:** `SectionDoneBar` — fixed UI in the shell (like `CompletionCard`), rendered
  under the log while the newest group's section still has outstanding fields and the
  application is open. One button: "Done with this section". Old groups never carry
  their own buttons — there is exactly one Done on screen, for the current section.
- **Transport:** `POST …/turn` gains `{ doneWith: Section }` beside `text`; exactly
  one of the two per request. The route validates `doneWith` against the `Section`
  union.
- **Transcript:** the server commits an applicant turn whose text is vetted copy
  (`done_chip`, e.g. "Done with this section — what's next?") so the audit trail
  records the act; the chat renders it as an ordinary applicant bubble.
- The composer, suggestions, and free-text chat are unchanged and legal at any time;
  a typed question mid-section gets an answer (explain/rationale) and stays in the
  section.

## 6. What is removed

`useIdleNudge`, its `panelWrites` wiring through `page.tsx` → `ConversationShell`,
and `useConversation.nudge`. No turn ever arrives unprompted. (`panelWrites` itself
stays in `useApplication` only if something else consumes it; if nothing does, it
goes too.)

2026-08-06: amended, agreed with Kaly after a live strand — a successful upload's
response MAY carry a planner-built agent turn presenting the current group. This is
still prompted, not unprompted: the upload is the applicant acting.

## 7. New vetted copy

One `COPY_VERSION` bump ('5' → '6'):

- `done_chip` — the applicant-side Done bubble text.
- `section_incomplete` — the notice on a gapped Done ("A few answers in this section
  are still blank — they're marked below.") — interim wording, joins the legal batch.
- Section frame titles come from the existing `SECTION_LABEL`, which moves from
  panel-only use to shared use (it is already fixed copy; it joins the catalog only
  if legal wants per-section review).

## 8. What does not change

Reducer, requirements engine, audit log, OCR/provenance, the panel (`?debug`),
`CompletionCard`, `OpeningUploadCard`, composer/attach, §9.1 focus rules,
red-is-brand, and the voice-lint pipeline.

## 9. Module layout

```
src/domain/orchestrator/plan.ts        new — SECTION_ORDER, sectionPlan
src/domain/orchestrator/transcript.ts  section_header block kind
src/domain/orchestrator/tools.ts       askFor leaves the offered set
src/server/orchestrator/service.ts     group-turn construction from the plan
src/server/application-service.ts      doneWith intent; done_chip applicant turn
src/app/api/application/[id]/turn/route.ts   doneWith validation
src/ui/chat/blocks.tsx                 section_header case (titled frame)
src/ui/chat/SectionDoneBar.tsx         new — the one Done button
src/ui/chat/ConversationShell.tsx      mounts SectionDoneBar; nudge wiring removed
src/ui/client/useConversation.ts       sendDone(section); nudge removed
src/ui/client/useIdleNudge.ts          deleted
src/domain/orchestrator/copy.ts        done_chip, section_incomplete; version '6'
```

## 10. Testing

- `plan.ts`: pure tests across profile shapes — individual, business (adds
  `business`/`tax`), dealer licenses, `addressDiffersFromId`, GSA, Ohio state forms;
  order stability; `null` at completion.
- Service: a dead model still produces a correct titled group; gapped Done re-presents
  only the missing fields with `section_incomplete`; complete Done advances; the
  final Done is contradiction-free.
- Shell: exactly one Done bar, on the current group; gone once submitted; Done posts
  `doneWith`, not text.
- Every new test runs RED first; sabotage checks after GREEN and **after commit** —
  never against uncommitted fixes.
- Chrome walk: license upload → identification group → Done through every section →
  CompletionCard → submission, on the real dev server.
