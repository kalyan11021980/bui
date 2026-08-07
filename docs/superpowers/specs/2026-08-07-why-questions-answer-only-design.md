# Why-questions get real answers, not the section dump — design

Date: 2026-08-07
Status: approved by Kaly (sections reviewed in conversation)

Kaly's report, in two rounds. First: clicking a start-screen pill like "Why
do you ask 'What best describes you?'" returns a spoken answer — followed by
the full current group (section header, every field control) and the "Done
with this section" bar. A question about a field should not read as a demand
to fill the form. Second (live screenshots): the answers themselves can be
broken — one reply was the raw marker `[explained: location_country]`
rendered as the agent's voice; another was the bare catalog rationale
("Decides which questions the rest of the application asks / Required by
IAA") with no sentence framing it.

Three defects, three fixes in this spec: the planner's re-present (§1–2),
the voice-lint gap that let tool narration through (§3), and the missing
deterministic framing for a rationale-only turn (§4). The model's own spoken
answer stays the star; the vetted catalog line stays the auditable floor.

The planner already stays put for mid-section questions
(`planTurnBlocks` presents only when the plan's section is not the newest on
screen). The gap is the first presentation (empty transcript) and the
advancing presentation (previous group just completed): both fire regardless
of what the applicant said.

## 1. The rule

A **why-shaped applicant turn never triggers a section presentation** — not
the first, not an advancing one. The answer arrives alone; the group presents
on the next non-why turn (or upload, or Done).

Why-shaped: trimmed, lowercased text that starts with the word "why"
(`/^why\b/`) or contains "why do you".

Unchanged behavior:

- "What else do you need?" and any other non-why text: present when the
  plan's section is not already the newest on screen (current rule). That
  pill's honest answer IS the outstanding list.
- `Done` turns (structured `doneWith`): always present.
- Upload responses (`presentPlan` after a document read): always present.
- **Degraded fallback** (model call failed, `runTurnSafely` catch path):
  still presents even for a why-turn — there is no answer to stand in for
  the group, and `degraded_notice` + nothing else is a dead end.

UI consequence, with no UI change: no section header in the reply means no
field controls and no Done bar under a why-answer — `SectionDoneBar` already
derives from the newest `section_header` on screen.

## 2. Implementation

- `src/domain/orchestrator/plan.ts`: export `isWhyShaped(text: string):
  boolean` holding the heuristic. `planTurnBlocks` gains the applicant's
  text (`applicantText: string | null`; null for Done turns and the upload
  path) and returns `[]` when `doneWith === null` and the text is
  why-shaped, before the existing newest-on-screen check.
- `src/server/orchestrator/service.ts` (model path): thread the turn
  request's applicant text into the `planTurnBlocks` call.
- `src/server/application-service.ts`: the degraded-fallback call passes
  `null` (keeps presenting); `presentPlan`'s call passes `null` (unchanged).
- The orchestrator prompt derives from state, not from the planned blocks,
  and the guard-fallback notice still covers a why-turn where the model
  produced no voice and no blocks. No prompt changes; the only copy change
  is §4's `rationale_intro`.

## 3. Voice-lint: bracketed colon markers are tool syntax

`TOOL_SYNTAX` in `src/domain/orchestrator/voice-lint.ts` catches
`[askFor(…)]`-style narration but not the observed `[explained:
location_country]` — bracket + word + colon, no paren. Extend the rule with
that shape: a `\[\s*\w+\s*:` alternative alongside the existing paren forms.
A model narrating a completed tool is dropped like a model narrating a call;
the existing `decideVoice` flow then leaves `voice: null` and the fallbacks
below take over. No new violation code — this is more `tool_syntax`.

## 4. Vetted framing for a rationale-only turn

When a turn's blocks include a `rationale` and no voice survived (the model
said nothing, or lint dropped it), the turn currently reads as bare catalog
copy. Add a vetted line spoken above it:

- New copy id `rationale_intro`: "Here's why we ask:" — interim wording,
  joins the open legal-copy batch. COPY_VERSION bumps to '10' (the
  shown-copy hash test's prefix becomes `v10|`).
- In `src/server/orchestrator/service.ts`, after `decideVoice`: if
  `voice.text === null` and any block is `kind: 'rationale'`, unshift
  `{ kind: 'notice', copyId: 'rationale_intro' }` — the same pattern as the
  existing `guard_fallback` notice, which keeps covering the
  no-blocks-no-voice case.

## 5. Testing

Domain tests (`tests/domain/orchestrator/plan.test.ts`):

- `isWhyShaped`: accepts "Why do you need my last name?", "Why do you ask
  "Which ID will you use?"", "why is that required", mixed case and padded
  whitespace; rejects "What else do you need?", "I'm ready", "Tell me why
  later" is accepted only if it contains "why do you"/starts with "why "
  (it does neither → rejected).
- `planTurnBlocks`: why-turn on an empty transcript → no group; "What else
  do you need?" on an empty transcript → group; why-turn when the plan has
  advanced past the newest-on-screen section → no group; non-why turn same
  state → group; Done turn with why-ish text impossible by construction
  (payload is one of text | doneWith) — Done keeps presenting.

Voice-lint tests (`tests/domain/orchestrator/voice-lint.test.ts` additions):
`[explained: location_country]` → `tool_syntax`; `[askFor(field: x)]` still
caught; ordinary bracketed prose without a colon-or-paren marker shape (e.g.
"we ask [almost] nothing else") still passes.

Copy tests: `rationale_intro` exact string under COPY_VERSION '10'; the
transcript hash test's prefix updated.

Integration (`tests/integration/turn-route.test.ts` additions): a first-turn
why-question's response turn carries no `section_header`; a first-turn
"What else do you need?" carries one; the degraded path (model fetch fails)
still carries one for a why-question; a model reply of
`[explained: location_country]` with no tool call yields a turn whose voice
is null and whose blocks carry `guard_fallback` (never the raw marker); a
turn with an `explain` tool call and no surviving voice carries
`rationale_intro` before the `rationale` block.

## Out of scope

- No model-signaled presentation control (the model never chooses grouping).
- No changes to suggestion texts or the start screen.
- No re-present suppression for Done, uploads, or the degraded path.
- No prompt changes to make the weak local model call `explain` more
  reliably, and no model swap — the Azure Foundry provider task on the
  backlog is the lever for consistently better spoken answers.
