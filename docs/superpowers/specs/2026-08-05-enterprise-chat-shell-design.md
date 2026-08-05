# Enterprise chat shell — visual system and the upload entry point

**Date:** 2026-08-05
**Amends:** `2026-08-01-iaa-genui-registration-design.md` §9 (presentation only) —
no change to §9.1's focus/interruption invariants, which this design re-asserts.
**Depends on:** Phase 3 (chat-first registration), merged as `19ee0c3`.

## 1. What this delivers

Two defects observed on first look at the product:

1. The chat reads as unstyled text on a white void — no identity, no hierarchy,
   nothing that says "enterprise" or even "finished".
2. The opening beat ends with *"The fastest start is your driver's license"* and
   offers nowhere to put one. The only upload surface lives in the `?debug`
   panel, and the chat's own `document_request` block only appears if the agent
   emits one on a later turn. A first-time applicant is stuck at hello.

This phase dresses the chat in an IAA-branded, Claude-desktop-calibre visual
system and gives the license photo a home the applicant cannot miss. Nothing
else in the product changes.

## 2. Decisions taken before design

| Decision | Choice |
|---|---|
| Identity | IAA-branded product shell. Brand red `#B82018` is the accent; red never signals error. |
| Visual language | Claude desktop: warm near-white page, one centred reading column, agent speech as typeset prose, soft rounded surfaces. |
| Layout | Branded top bar + centred ~720px conversation column. No progress rail. |
| Styling stack | Tailwind CSS v4. `tokens.ts` stays canonical for TS-consumed colors. |
| Upload entry | Both: an opening upload card under the greeting, and a persistent attach button in the composer. |
| Scope | Chat surface only. The `?debug` panel keeps its current styling. |

## 3. Visual system

Tailwind v4 (`tailwindcss` + `@tailwindcss/postcss`), a `src/app/globals.css`
with `@import "tailwindcss"` and an `@theme` block defining the palette, type
scale, radii and shadows.

- **Palette:** the thirteen `COLOR` values from `src/ui/theme/tokens.ts`,
  re-declared as `--color-*` theme variables. `tokens.ts` remains the source of
  truth for TypeScript consumers (`STATUS_COLOR` drives per-status rendering
  programmatically). A unit test parses `globals.css` and asserts every
  `COLOR` value appears verbatim, so the two declarations cannot drift.
- **Page:** warmed from `#F8F8F8` toward a Claude-like near-white warm gray
  (single new token, `page` adjusted in both places; the parity test keeps
  them honest).
- **Type scale:** 15px body / 1.6 line height for speech, 13px meta/secondary,
  a small-caps or semibold 13px for card titles. System font stack (no webfont
  dependency; `-apple-system, Segoe UI, …`).
- **Surfaces:** cards are `surface` white, 1px `divider` border, 12px radius,
  a shadow so subtle it reads as lift, not decoration.
- **Red is the brand, never error** — unchanged. `error`/`errorSurface` stay
  orange. `STATUS_COLOR` semantics untouched.

## 4. App frame

A sticky top bar owned by `page.tsx` (rendered above both chat and debug
panel): left, an IAA wordmark — red rounded square bearing "IAA" plus "Buyer
Registration" in text; right, a quiet reassurance chip (lock glyph + vetted
copy `header_reassurance`, e.g. review-within-24h). White bar, hairline bottom
border, content scrolls beneath it. The page behind the column takes the warm
`page` tone.

New vetted copy (`header_reassurance`) goes through the catalog like every
other legally-visible string; interim wording ships now and joins the legal
copy batch already open with Kaly.

## 5. Conversation presentation

- **Agent turns:** a 24px round brand-red monogram avatar in the gutter of the
  first paragraph of each agent turn; the speech itself is typeset prose on
  the page — no bubble — exactly as the opening beat renders today, but on the
  new scale.
- **Applicant messages:** right-aligned soft bubbles, neutral `surface` with
  border, max-width ~75% of the column.
- **Blocks** (`field_ask`, `document_request`, `notice`, `orientation`,
  `rationale`): cards per §3. Their internal controls pick up the scale but
  keep every behavioural rule (never-`disabled`, focus preservation,
  `aria-disabled` signalling).
- **Thinking indicator:** unchanged in behaviour; restyled to match meta text.
- An agent turn with no voice and no blocks still legally renders null.

## 6. The opening upload card

The opening beat keeps its vetted paragraphs and gains, directly under the
"fastest start" line, a real upload card for the ID the profile says the
applicant holds — `documentsToUpload(state.profile)[0]`, the driver's license
by default:

- Document glyph, `DOC_LABEL[docType]` title, one-line vetted rationale.
- A brand-red **Upload photo** button (file input, camera-capable on mobile via
  `capture`-friendly `accept`), plus drag-and-drop onto the card. It is the
  existing `DocumentUpload` read path — `onReadDocument(docType, image)` — so
  OCR, provenance and audit are exactly the panel's.
- A quiet escape line: answering in chat stays legal ("or just tell me and
  I'll ask for the photo later" — vetted copy, `opening_upload_alternative`).
- The card renders only while no document of that type has been read
  (`app.documents`), and never after submission. It is fixed UI, not a model
  turn: a cold model cannot cost the applicant the entry point, the same
  guarantee the opening beat already carries.

## 7. Composer

One rounded-rect card in the sticky footer housing three controls:

- **Attach** (paperclip, left): opens the file picker directly when exactly one
  outstanding document type remains un-read; when several, a small menu of
  `documentsToUpload(state.profile)` minus already-read types, labelled with
  `DOC_LABEL`. Routes through `onReadDocument` like every other upload.
- **Input** (centre): borderless within the card, placeholder from vetted copy.
- **Send** (right): circular, brand red when sendable, dimmed via opacity +
  `aria-disabled` otherwise — never the `disabled` attribute, focus is never
  stolen, exactly the §9.1 contract the current code keeps.

Suggestions remain above the composer as quiet gray chips on the new scale.
`ConversationShell` has grown past one reason to change; the composer (with
attach) and the opening card are extracted to their own files.

## 8. What does not change

The orchestrator, guard, reducer, requirements engine, audit log, OCR pipeline,
`?debug` panel styling, suggestion logic, idle nudge, and every §9.1
accessibility invariant. No new copy reaches the screen except through the
vetted catalog.

## 9. Module layout

```
src/app/globals.css              new — Tailwind entry + @theme tokens
src/app/layout.tsx               imports globals.css
src/app/page.tsx                 renders AppHeader; page background
src/ui/chrome/AppHeader.tsx      new — wordmark, title, reassurance chip
src/ui/chat/ConversationShell.tsx  slims down; consumes the two new pieces
src/ui/chat/Composer.tsx         new — input + attach + send (extracted)
src/ui/chat/OpeningUploadCard.tsx  new — §6
src/ui/chat/TurnView.tsx         avatar gutter, bubble styling
src/ui/chat/blocks.tsx           card styling
src/ui/chat/Suggestions.tsx      chip styling
src/ui/theme/tokens.ts           unchanged values (page warm-up excepted)
```

## 10. Testing

- Existing suite (965) stays green; tests assert roles and text, not pixels.
  Any that assert inline styles are updated to the new classes.
- New: opening card renders before any turn and routes an image through
  `readDocument`; card absent once the document is read; attach button
  single-vs-menu behaviour; token parity test (§3). Each new test is checked
  to fail when its behaviour is broken (a mutation must fail loudly).
- `pnpm typecheck` output recorded per task.
- Final gate: drive the app in Chrome as a real applicant with
  `sample/licenses/specimens/dc_2018.png` — upload from the opening card,
  watch the fields fill, then repeat via the attach button.
