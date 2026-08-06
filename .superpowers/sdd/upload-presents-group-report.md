# upload-presents-group — report

## The bug

Uploading a document at the opening (before typing anything) filled fields but
presented nothing — no group, no field cards, no Done bar. Group turns only
happened on `POST /turn`; the deleted idle nudge used to fire one after an
upload, and nothing replaced it.

## The fix

An upload is an applicant act, so its response now presents the group —
deterministically, server-side, no model call.

1. `src/server/application-service.ts` — new exported `presentPlan(id,
   ownerToken, at)`. Loads the owned application, refuses when submitted,
   computes `planTurnBlocks(state, state.transcript, null)`; if non-empty,
   commits an `APPEND_TURN` (agent, `voice: null`). Empty blocks return the
   current state untouched — the planner's own dedup rule already prevents
   re-presenting a section already on screen.
2. `src/server/document-service.ts` — `ingestDocument`'s success path now
   calls `presentPlan` after the fill loop, always (even when `filled` is
   empty). On success the returned state replaces `IngestOutcome.state`; on
   failure (e.g. a concurrent submit) the upload still succeeds, carrying the
   state it already has.
3. `src/ui/client/useConversation.ts` — new `ingest(state)` on the hook's
   return: appends turns with `seq > seen.current`, advances `seen.current`,
   never touches existing (including negative-seq optimistic) turns. Shared
   the "what's new since `seen`" logic with `post` via a `newSince` helper.
4. `src/ui/chat/ConversationShell.tsx` — calls `ingest(state)` in an effect
   keyed on `state.transcript.length`, so an upload's response (which never
   goes through `send`/`sendDone`) still lands in the log.
5. `docs/superpowers/specs/2026-08-05-section-flow-design.md` §6 — appended a
   dated line: a successful upload's response MAY carry a planner-built agent
   turn presenting the current group, prompted by the upload (the applicant
   acting) — agreed with Kaly 2026-08-06.

## TDD evidence

### Integration — `tests/integration/document-route.test.ts`

RED (before `presentPlan` existed / was wired in):
```
× presents the group after an upload at the opening, before anything is typed
  → expected [] to have a length of 1 but got +0
× does not re-present a section a second upload leaves still on screen
  → expected [] to have a length of 1 but got +0
```
GREEN: both pass after wiring `presentPlan` into `ingestDocument`.

### Client — `tests/ui/client/useConversation.test.ts`

RED (before `ingest` existed):
```
× ingest > appends only turns newer than what has been seen
  → result.current.ingest is not a function
× ingest > a second ingest of the same state is a no-op
× ingest > never touches an optimistic negative-seq echo already on screen
```
GREEN: all 3 pass after adding `ingest` + `newSince`.

### Shell — `tests/integration/page-upload.test.tsx`

RED (before the `ConversationShell` effect existed) — this is the literal
regression test for the reported bug: rendered the page without `?debug`,
uploaded through `OpeningUploadCard`, and the response's mocked
`state.transcript` (a `section_header` + `field_ask` turn) never reached the
log:
```
× presents the group in the chat after an upload at the opening — no prior typing
  → could not find role="group" name /driver's license number/i (timed out)
```
GREEN: passes once `ConversationShell` calls `ingest(state)` on a
transcript-length change.

## Pre-existing tests updated (behavior change, not regressions)

Two existing tests encoded "an upload never appends an agent turn," which is
exactly the bug being fixed — updated to the new, intended behavior:

- `tests/server/document-service.test.ts` — "fills nothing and fails nothing
  when the read yields no fields, but still records the upload": audit trail
  size for that upload is now 2 (`document_recorded` + `agent_turn`), not 1 —
  presentPlan still runs and presents the group when a read yields nothing.
- `tests/integration/turn-route.test.ts` — "rejects a request for a document
  already uploaded, once genuinely ingested": the ingest step now also
  appends an `agent_turn` audit entry, so the test's `.find` for the first
  `agent_turn` entry no longer lands on the `/turn` call's own turn (the one
  carrying `rejections`). Changed to take the last `agent_turn` entry instead
  of the first.

## Files changed

- `src/server/application-service.ts`
- `src/server/document-service.ts`
- `src/ui/client/useConversation.ts`
- `src/ui/chat/ConversationShell.tsx`
- `docs/superpowers/specs/2026-08-05-section-flow-design.md`
- `tests/integration/document-route.test.ts`
- `tests/ui/client/useConversation.test.ts`
- `tests/integration/page-upload.test.tsx`
- `tests/server/document-service.test.ts`
- `tests/integration/turn-route.test.ts`

## Full suite

```
Test Files  82 passed | 3 skipped (85)
     Tests  1033 passed | 4 skipped (1037)
```

## Typecheck

```
$ npx tsc --noEmit
(no output — clean)
```

## Self-review

- `presentPlan` reuses the private `owned`/`commit` helpers exactly as the
  spec asked, and mirrors the `submittedRefusal` → `failure('submitted', …)`
  pattern already used by `applyAction`/`applyTurn`.
- `ingestDocument` calls `presentPlan` unconditionally (not gated on
  `filled.length > 0`) — an unreadable photo still deserves a presented
  group, not a stranded applicant.
- `useConversation.ingest` never removes or replaces anything already in
  `turns` — it only appends — so an in-flight optimistic echo from
  `send`/`sendDone` is safe from a concurrent `ingest` call.
- `ConversationShell`'s effect is keyed on `state.transcript.length` rather
  than `state`/`ingest` identity, since both are recreated every render and
  would otherwise fire the effect on unrelated re-renders (though the
  dedup inside `ingest` makes that merely wasteful, not wrong).
- Two pre-existing tests had to change. Both encoded the absence of the
  behavior this task adds (an upload never producing an agent turn) — not an
  unrelated invariant — so updating them is fixing stale expectations, not
  papering over a defect.
- Comments kept short, no section references, per house style.
