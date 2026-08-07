# Start screen with docking composer + inline reading status — design

Date: 2026-08-07
Status: approved by Kaly (sections reviewed in conversation)

Two UI changes to the chat shell:

1. A centered start screen — big greeting, a card row (license upload + field
   suggestions), a large composer — that docks into the normal conversation
   layout on the applicant's first action, with an animated transition.
2. The "Reading your photo…" status moves inline into the upload card while
   that card's document is being read.

Reference: two images Kaly supplied — a hero start screen (greeting, prompt
cards, large composer on an empty canvas) and a conventional chat view with a
docked bottom composer.

## 1. Start screen layout and the docking rule

`ConversationShell` derives a `started` flag from existing state — no new
stored state:

```
started = turns.length > 0
  || state.transcript.length > 0
  || state.documents.length > 0
  || readingDocument
  || pending
  || state.submittedAt !== null
```

A resumed, submitted, or mid-read application never sees the start screen; a
brand-new application always does.

The flag **latches**: once it computes true in a session it stays true (a
ref), so a failed first read — no document committed, no turn, nothing else
truthy — cannot un-dock the screen back to the centered layout.

**`started === false` — centered layout** (replaces today's top-to-bottom
flow; same 680px max-width column, vertically centered):

- Big two-line headline `start_headline` with subline `start_subline` — new
  vetted copy keys, interim wording joining the open legal-copy batch. The
  `opening_beat` paragraphs retire; after docking the greeting is simply gone.
- A horizontal card row: the **upload card first** (the same
  `OpeningUploadCard` component, restyled to card-row size), then the first
  **three (or fewer) field-driven suggestion cards** — the same
  `outstandingFields`-derived suggestions the docked chips use, rendered as
  cards. Clicking one sends
  that prompt exactly as the chips do.
- The **large composer** below the row — the same mounted `Composer`
  component (same form, paperclip logic, send button), styled larger via a
  size prop or wrapper class. It must remain the same mounted DOM element in
  both layouts: that is what makes the view transition and focus
  preservation work. The start layout must never conditionally unmount the
  composer form, only restyle it.

**`started === true` — docked layout** (today's): opening upload card at the
top of the log until the license commits (unchanged), turns, status lines,
section done bar, completion card, sticky composer + suggestion chips.

**Docking trigger:** the applicant's first action — sending a text message
(`pending` flips) or starting a license upload (`readingDocument` flips).
Consequence: the "Thinking…" / "Reading…" beat always plays in the docked
view, never on the start canvas.

## 2. The dock animation

Built on the **View Transitions API** — no hand-rolled FLIP.

- The composer wrapper gets `view-transition-name: composer`; the greeting
  block and card row get their own names so they cross-fade out rather than
  pop.
- The `started` false→true flip runs inside
  `document.startViewTransition(() => flushSync(update))`. The browser
  animates the composer from center to bottom (default ~250ms; tune with
  `::view-transition-group(composer)` CSS only if the default reads wrong).
- Trigger plumbing: `send` and the upload intake are our own call sites; the
  transition wraps the state change those entry points make. Invariant:
  exactly one transition, fired by the applicant's first action. The
  implementation plan pins the exact hook point.
- Degradation: if `document.startViewTransition` is absent, or
  `prefers-reduced-motion: reduce` matches, call the update directly —
  instant swap. One guard, no second code path.
- Focus (§9.1): the composer input is the same DOM element throughout, so
  focus survives; nothing is disabled or unmounted mid-flight.

## 3. Inline reading status (#18)

`readingDocument` becomes doc-type-aware:

- `useApplication` already counts in-flight reads; it will expose
  `readingDocTypes: DocType[]` (doc types currently queued or fetching). The
  shell derives the old boolean from it.
- `OpeningUploadCard` receives `readingDocTypes`. While its own doc type is
  in the list, the "Upload photo" label/input swaps for the shared status row
  (`role="status"`, dots, "Reading your photo…") — which also removes the
  double-upload path. The card still disappears only when the document
  commits.
- The shell's floating "Reading your photo…" line renders only for reads not
  shown on a visible card — the card is gone, or the read is a different doc
  type (composer paperclip for a second document). No read is ever silent;
  none is announced twice.

## 4. Copy and versioning

- New vetted keys: `start_headline`, `start_subline` — interim wording,
  flagged in the legal batch.
- `opening_beat` retired from the shell.
- COPY_VERSION bumps to '8'; the shown-copy hash test updates.

## 5. Testing and verification

- RTL: start screen renders only for the truly-new state (each `started`
  input flips it); first send and first upload intake both dock; suggestion
  cards send their prompt; the card shows inline status while its doc type
  reads and the floating line stays away; the floating line still appears
  for a non-card read; the reduced-motion / missing-API guard calls the
  update directly (jsdom has no `startViewTransition`, so tests inherently
  exercise the fallback).
- Typecheck output recorded per task.
- Chrome walk before claiming done: start → animated dock → upload → inline
  status.

## Out of scope

- No sidebar, avatars, prompt-refresh, or character counter from the
  reference images.
- No change to the panel, submission flow, or section flow.
- No animation work beyond the single dock transition.
