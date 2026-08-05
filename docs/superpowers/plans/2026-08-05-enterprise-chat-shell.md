# Enterprise Chat Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dress the chat in an IAA-branded, Claude-desktop-style visual system and give the driver's-license photo an upload home the applicant cannot miss (opening card + composer attach).

**Architecture:** Tailwind v4 supplies the visual system through an `@theme` block generated from the existing `COLOR` palette; a parity test stops the two declarations drifting. The upload fix reuses the existing `onReadDocument` path end to end: a shared intake module (extracted from the panel's `DocumentUpload`) judges files, and two new chat components — `OpeningUploadCard` and `Composer` — feed it. No orchestrator, reducer, or server change.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4 (`@tailwindcss/postcss`), Vitest + Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-05-enterprise-chat-shell-design.md`

## Global Constraints

- Package manager is **pnpm**. Run tests with `pnpm test`, types with `pnpm typecheck`.
- **Red is the brand, never error.** `#B82018` is the accent; errors stay orange `#E87830`.
- **Never set the `disabled` attribute** on the composer input, send, or attach controls; signal with `aria-disabled` + opacity, refuse in the handler. Focus is never stolen by an update (§9.1).
- **Every applicant-visible fixed string** comes from `vettedCopy(...)` in `src/domain/orchestrator/copy.ts`. Any edit to `COPY` bumps `COPY_VERSION`.
- **TDD, and audit your own tests:** run each new test RED before implementing; after GREEN, sabotage the implementation once (e.g. remove the render guard) and confirm the test fails loudly, then restore. A test that cannot fail is a plan failure.
- **Paste `pnpm typecheck` output** (expected: no output, exit 0) into the task report for every task. Reviewers cannot see typecheck failures in a diff.
- The `?debug` panel keeps its current inline styling. Do not restyle `src/ui/panel/*` beyond what Task 4 moves.
- Existing selectors the suite relies on must survive: composer label text `Tell the agent something`, a button with accessible name `Send`.

---

### Task 1: Tailwind v4 wiring, theme tokens, parity test

**Files:**
- Create: `postcss.config.mjs`
- Create: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/ui/theme/tokens.ts` (one value: `page`)
- Test: `tests/ui/theme/token-parity.test.ts`

**Interfaces:**
- Consumes: `COLOR` from `src/ui/theme/tokens.ts`.
- Produces: Tailwind utilities with color names `primary`, `primary-disabled`, `success`, `success-surface`, `error`, `error-surface`, `text-primary`, `text-secondary`, `text-muted`, `border`, `divider`, `page`, `surface`, plus `shadow-card`. Later tasks write e.g. `bg-primary`, `border-divider`, `text-text-secondary`, `shadow-card`.

- [ ] **Step 1: Write the failing parity test**

`tests/ui/theme/token-parity.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { COLOR } from '@/ui/theme/tokens'

/**
 * tokens.ts stays canonical for TS consumers (STATUS_COLOR); globals.css
 * re-declares the palette for Tailwind. This is the drift guard.
 */
describe('theme token parity', () => {
  const css = readFileSync(
    new URL('../../../src/app/globals.css', import.meta.url), 'utf8',
  ).toLowerCase()

  it.each(Object.entries(COLOR))('%s (%s) appears in globals.css', (_name, value) => {
    expect(css).toContain(value.toLowerCase())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/ui/theme/token-parity.test.ts`
Expected: FAIL — `ENOENT ... src/app/globals.css`

- [ ] **Step 3: Install Tailwind and wire PostCSS**

```bash
pnpm add -D tailwindcss @tailwindcss/postcss
```

`postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

- [ ] **Step 4: Create globals.css and warm the page token**

In `src/ui/theme/tokens.ts` change one value (warm near-white, Claude-desktop tone):

```ts
  page: '#FAF9F7',
```

`src/app/globals.css`:

```css
@import "tailwindcss";

/* Values mirror src/ui/theme/tokens.ts — tests/ui/theme/token-parity.test.ts
   fails if these drift. */
@theme {
  --color-*: initial;
  --color-primary: #B82018;
  --color-primary-disabled: #E0B0B0;
  --color-success: #408030;
  --color-success-surface: #E0E8D8;
  --color-error: #E87830;
  --color-error-surface: #F8E8D8;
  --color-text-primary: #202020;
  --color-text-secondary: #404040;
  --color-text-muted: #A8A8A8;
  --color-border: #C8C8C8;
  --color-divider: #E0E0E0;
  --color-page: #FAF9F7;
  --color-surface: #FFFFFF;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.05), 0 1px 3px rgb(0 0 0 / 0.04);
}

body {
  margin: 0;
  background: var(--color-page);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}
```

`src/app/layout.tsx` becomes:

```tsx
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'IAA Buyer Registration' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 5: Run the parity test (PASS), then the whole suite**

Run: `pnpm test tests/ui/theme/token-parity.test.ts` — expected: 13 passing cases.
Run: `pnpm test` — expected: everything green (the `page` value is not asserted anywhere; if a test does pin `#F8F8F8`, update it to read `COLOR.page`).
Sabotage check: change `--color-primary` to `#B82019` in globals.css → parity test fails → restore.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add -A && git commit -m "feat(ui): wire Tailwind v4 with the IAA palette as theme tokens"
```

---

### Task 2: Vetted copy additions + AppHeader + page frame

**Files:**
- Modify: `src/domain/orchestrator/copy.ts`
- Create: `src/ui/chrome/AppHeader.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/ui/chrome/AppHeader.test.tsx`

**Interfaces:**
- Consumes: `vettedCopy` from `@/domain/orchestrator/copy`; Tailwind color names from Task 1.
- Produces: `AppHeader(): JSX.Element` (no props), exported from `@/ui/chrome/AppHeader`. New copy ids `header_reassurance`, `opening_upload_alternative`, `composer_placeholder` — Tasks 4 and 5 resolve the latter two through `vettedCopy`.

- [ ] **Step 1: Write the failing test**

`tests/ui/chrome/AppHeader.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppHeader } from '@/ui/chrome/AppHeader'
import { vettedCopy } from '@/domain/orchestrator/copy'

describe('AppHeader', () => {
  it('is a banner carrying the product name and the vetted reassurance line', () => {
    render(<AppHeader />)
    const banner = screen.getByRole('banner')
    expect(banner).toHaveTextContent('Buyer Registration')
    expect(banner).toHaveTextContent(vettedCopy('header_reassurance'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/ui/chrome/AppHeader.test.tsx`
Expected: FAIL — cannot resolve `@/ui/chrome/AppHeader` (and `header_reassurance` is not a `VettedCopyId`).

- [ ] **Step 3: Add the three copy ids**

In `src/domain/orchestrator/copy.ts`: set `COPY_VERSION = '2'`, extend `ALL_COPY_IDS` with `'header_reassurance', 'opening_upload_alternative', 'composer_placeholder'`, and add to `COPY`:

```ts
  header_reassurance:
    'Checked by a person on Buyer Services — usually within 24 hours.',

  opening_upload_alternative:
    "Or just answer in chat — I'll ask for the photo when it's needed.",

  composer_placeholder: 'Message your registration agent…',
```

These are interim wordings; they join the open legal copy batch alongside `guard_fallback` and `panel_only_notice`.

- [ ] **Step 4: Implement AppHeader and mount it**

`src/ui/chrome/AppHeader.tsx`:

```tsx
import { vettedCopy } from '@/domain/orchestrator/copy'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-divider bg-surface px-5 py-3">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-bold tracking-tight text-surface"
      >
        IAA
      </span>
      <span className="text-[15px] font-semibold">Buyer Registration</span>
      <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-divider bg-page px-3 py-1 text-[12px] text-text-secondary sm:flex">
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3Z" />
        </svg>
        {vettedCopy('header_reassurance')}
      </span>
    </header>
  )
}
```

In `src/app/page.tsx`, render it above `<main>` in both return branches (the loading branch too — the frame must not flash in later):

```tsx
import { AppHeader } from '@/ui/chrome/AppHeader'
```

```tsx
  if (!state) {
    return (
      <>
        <AppHeader />
        <main style={{ padding: 24 }}>
          <p role="status" style={notice}>{app.notice ?? STARTING}</p>
        </main>
      </>
    )
  }
```

and wrap the main return the same way (`<><AppHeader /><main …>…</main></>`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/ui/chrome/AppHeader.test.tsx` — expected: PASS.
Run: `pnpm test` — expected: green. If a copy test enumerates `ALL_COPY_IDS` or pins `COPY_VERSION`, update it to the new list/value — that is the test doing its job.
Sabotage check: drop `header_reassurance` from the JSX → test fails → restore.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add -A && git commit -m "feat(ui): branded app header with vetted reassurance copy"
```

---

### Task 3: Conversation restyle — turns, blocks, suggestions

**Files:**
- Modify: `src/ui/chat/TurnView.tsx`
- Modify: `src/ui/chat/blocks.tsx`
- Modify: `src/ui/chat/Suggestions.tsx`
- Modify: `src/ui/chat/ConversationShell.tsx` (opening paragraphs + thinking indicator styles only — structure changes come in Tasks 4–5)
- Test: existing `tests/ui/chat/*.test.tsx` (must stay green; no new tests — this task changes presentation, not behaviour)

**Interfaces:**
- Consumes: Tailwind names from Task 1.
- Produces: nothing new — same exports, same roles, same text.

- [ ] **Step 1: Restyle TurnView**

Replace the three style objects and both branches:

```tsx
export function TurnView({ turn, state, onChange, onClear, onConfirm, onReadDocument }: Props) {
  if (turn.role === 'applicant') {
    return (
      <p className="my-3 ml-auto w-fit max-w-[75%] rounded-2xl rounded-br-md border border-divider bg-surface px-4 py-2 text-[15px] leading-normal">
        {turn.text}
      </p>
    )
  }

  if (turn.voice === null && turn.blocks.length === 0) return null

  return (
    <div className="my-3 flex gap-3">
      {/* The agent's mark. Decorative — the log's structure already says who speaks. */}
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-primary text-[9px] font-bold text-surface"
      >
        IAA
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {turn.voice !== null && (
          <p className="m-0 text-[15px] leading-relaxed">{turn.voice}</p>
        )}
        {turn.blocks.map((block, index) => (
          <BlockView
            key={`${block.kind}-${index}`}
            block={block}
            state={state}
            seq={turn.seq}
            onChange={onChange}
            onClear={onClear}
            onConfirm={onConfirm}
            onReadDocument={onReadDocument}
          />
        ))}
      </div>
    </div>
  )
}
```

Delete the now-unused `voiceStyle`, `applicantBubble`, `agentBlock` objects and the `COLOR` import if nothing else uses it. Note the applicant bubble goes from red-filled to neutral surface — red is the accent now, not a message color.

- [ ] **Step 2: Restyle blocks.tsx**

Wrap each interactive block case (`field_ask`, `document_request`) in the card treatment by giving its outermost element `className="rounded-xl border border-divider bg-surface p-4 shadow-card"` (merge with whatever layout classes/styles the case already carries; keep all ids, roles, handlers, and copy exactly as they are). `notice`/`orientation` paragraphs become quiet meta text: `className="m-0 text-[13px] text-text-secondary"`. Do not alter the `rationale` component's behaviour or any `STATUS_COLOR` usage — per-status color stays inline and programmatic.

- [ ] **Step 3: Restyle Suggestions**

```tsx
const chipClass =
  'cursor-pointer rounded-full border border-divider bg-surface px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-page'
```

Apply as `className={chipClass}` on each button (drop `chipStyle`), keep the container's `aria-label="Things you could ask"` and switch its inline style to `className="mt-3 flex flex-wrap gap-2"`.

- [ ] **Step 4: Restyle the shell's own text**

In `ConversationShell.tsx`: opening paragraphs get `className="mb-3 text-[15px] leading-relaxed"` (drop `openingStyle`); the thinking indicator paragraph gets `className="my-2 text-[13px] text-text-secondary"` (drop `thinkingStyle`). Leave shell/footer/composer structure alone — Tasks 4–5 rework it.

- [ ] **Step 5: Run the chat suite, then everything**

Run: `pnpm test tests/ui/chat` — expected: green (these tests select by role, label, and text; if any asserts a removed inline style, update it to assert the visible behaviour instead).
Run: `pnpm test` — expected: green.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add -A && git commit -m "feat(ui): typeset conversation — avatar gutter, neutral bubbles, block cards"
```

---

### Task 4: Shared intake module + OpeningUploadCard

**Files:**
- Create: `src/ui/upload/intake.ts`
- Modify: `src/ui/panel/DocumentUpload.tsx` (delegate to intake.ts; behaviour identical)
- Create: `src/ui/chat/OpeningUploadCard.tsx`
- Modify: `src/ui/chat/ConversationShell.tsx` (mount the card under the opening beat)
- Test: `tests/ui/chat/OpeningUploadCard.test.tsx`

**Interfaces:**
- Consumes: `documentsToUpload(profile)` from `@/domain/requirements/documents`; `ApplicationState` (`state.documents: readonly {documentId, docType, at}[]`, `state.submittedAt`); `PreparedImage` from `@/ui/panel/prepare-image`; `vettedCopy('opening_upload_alternative')` from Task 2.
- Produces:
  - `intake.ts`: `DOC_LABEL: Record<DocType, string>`; `TOO_SMALL`, `TEXT_ONLY`, `UNOPENABLE: string`; `judgeFile(file: File, prepare?: (f: File) => Promise<PreparedImage>): Promise<IntakeVerdict>` where `IntakeVerdict = { kind: 'unopenable' } | { kind: 're-take' } | { kind: 'ok'; image: PreparedImage; notice: string | null }`. Task 5's attach button uses all of these.
  - `OpeningUploadCard({ state, onReadDocument, prepare? })` — same `onReadDocument(docType, image)` signature as `BlockHandlers`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/chat/OpeningUploadCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpeningUploadCard } from '@/ui/chat/OpeningUploadCard'
import { createApplication, applicationReducer } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}

/* 1600px ≥ CROP_FLOOR_PX, so the band is 'full' and no notice shows. */
const IMAGE: PreparedImage = {
  imageBase64: 'aGk=', imageUrl: 'data:image/png;base64,aGk=',
  imageSize: { width: 1600, height: 1000 },
}
const prepare = async () => IMAGE

describe('OpeningUploadCard', () => {
  it('offers the license upload before anything else happens, and routes the photo', async () => {
    const onReadDocument = vi.fn()
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<OpeningUploadCard state={state} onReadDocument={onReadDocument} prepare={prepare} />)

    const input = screen.getByLabelText(/upload photo/i)
    await userEvent.upload(input, new File(['x'], 'dl.png', { type: 'image/png' }))

    expect(onReadDocument).toHaveBeenCalledWith('drivers_license', IMAGE)
  })

  it('leaves the applicant a spoken way out', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<OpeningUploadCard state={state} onReadDocument={vi.fn()} prepare={prepare} />)
    expect(screen.getByText(/or just answer in chat/i)).toBeInTheDocument()
  })

  it('is gone once a document of that type has been read', () => {
    const base = createApplication('app-1', PROFILE, 'owner-1')
    const state = applicationReducer(base, {
      type: 'RECORD_DOCUMENT', documentId: 'doc-1',
      docType: 'drivers_license', at: '2026-08-05T00:00:00.000Z',
    })
    const { container } = render(
      <OpeningUploadCard state={state} onReadDocument={vi.fn()} prepare={prepare} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/ui/chat/OpeningUploadCard.test.tsx`
Expected: FAIL — cannot resolve `@/ui/chat/OpeningUploadCard`.

- [ ] **Step 3: Vet the intake copy and extract the intake module**

Ruled 2026-08-05 (Kaly): the intake strings join the vetted catalog now, not the
legal batch. In `src/domain/orchestrator/copy.ts` bump `COPY_VERSION` to `'3'`,
extend `ALL_COPY_IDS` with `'upload_hint', 'upload_too_small',
'upload_text_only', 'upload_unopenable', 'doc_label_drivers_license',
'doc_label_state_id', 'doc_label_passport', 'doc_label_dealer_license',
'doc_label_proof_of_residency'`, and add to `COPY` (words unchanged from what
ships today — this is consolidation, not rewriting):

```ts
  upload_hint:
    'Lay it flat and fill the frame. We read what we can and ask you about the rest.',
  upload_too_small:
    'That photo is too small to read. Take another with the document filling the frame.',
  upload_text_only:
    'We read it, but the photo is too small to show you where each answer came from.',
  upload_unopenable:
    'We could not open that photo. Try another, or answer the questions below yourself.',
  doc_label_drivers_license: "Photo of your driver's license",
  doc_label_state_id: 'Photo of your state ID',
  doc_label_passport: 'Photo of your passport',
  doc_label_dealer_license: 'Photo of your dealer license',
  doc_label_proof_of_residency: 'Photo of your proof of address',
```

In `src/server/document-service.ts` (line 46 area) replace the literal
too-small string with `vettedCopy('upload_too_small')` — same refusal, now one
source. In `DocumentUpload.tsx` the hint paragraph becomes
`{vettedCopy('upload_hint')}`.

`src/ui/upload/intake.ts` — labels and notices resolved from the catalog, plus
the verdict function:

```ts
import type { DocType } from '@/domain/field-id'
import { bandForWidth } from '@/domain/ocr/quality'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { prepareImage, type PreparedImage } from '@/ui/panel/prepare-image'

export const DOC_LABEL: Record<DocType, string> = {
  drivers_license: vettedCopy('doc_label_drivers_license'),
  state_id: vettedCopy('doc_label_state_id'),
  passport: vettedCopy('doc_label_passport'),
  dealer_license: vettedCopy('doc_label_dealer_license'),
  proof_of_residency: vettedCopy('doc_label_proof_of_residency'),
}

export const TOO_SMALL = vettedCopy('upload_too_small')
export const TEXT_ONLY = vettedCopy('upload_text_only')
export const UNOPENABLE = vettedCopy('upload_unopenable')

export type IntakeVerdict =
  | { kind: 'unopenable' }
  | { kind: 're-take' }
  | { kind: 'ok'; image: PreparedImage; notice: string | null }

/** One judgement for every surface a photo can enter through. */
export async function judgeFile(
  file: File,
  prepare: (f: File) => Promise<PreparedImage> = prepareImage,
): Promise<IntakeVerdict> {
  let image: PreparedImage
  try {
    image = await prepare(file)
  } catch {
    return { kind: 'unopenable' }
  }
  const band = bandForWidth(image.imageSize.width)
  if (band === 're-take') return { kind: 're-take' }
  return { kind: 'ok', image, notice: band === 'text-only' ? TEXT_ONLY : null }
}
```

Rewrite `DocumentUpload.tsx`'s `handle` to use it, deleting its local copies of `DOC_LABEL` and the three notices (import them from `@/ui/upload/intake` instead — the rendered words must not change, and panel tests asserting those words prove it):

```ts
  const handle = async (file: File | undefined) => {
    if (!file) return
    setNotice(null)
    onChoose?.()
    const verdict = await judgeFile(file, prepare)
    if (verdict.kind === 'unopenable') { setNotice(UNOPENABLE); return }
    if (verdict.kind === 're-take') { setNotice(TOO_SMALL); return }
    setNotice(verdict.notice)
    onRead(verdict.image)
  }
```

Run: `pnpm test tests/ui/panel` — expected: green before moving on.

- [ ] **Step 4: Implement OpeningUploadCard and mount it**

`src/ui/chat/OpeningUploadCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { documentsToUpload } from '@/domain/requirements/documents'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { DOC_LABEL, TOO_SMALL, UNOPENABLE, judgeFile } from '@/ui/upload/intake'

type Props = {
  state: ApplicationState
  onReadDocument: (docType: DocType, image: PreparedImage) => void
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}

/**
 * The opening beat promises "the fastest start is your driver's license";
 * this is where the license goes. Fixed UI, not a model turn — a cold model
 * cannot cost the applicant the entry point.
 */
export function OpeningUploadCard({ state, onReadDocument, prepare }: Props) {
  const [notice, setNotice] = useState<string | null>(null)
  const docType = documentsToUpload(state.profile)[0]

  if (state.submittedAt !== null) return null
  if (state.documents.some((d) => d.docType === docType)) return null

  const handle = async (file: File | undefined) => {
    if (!file) return
    setNotice(null)
    const verdict = await judgeFile(file, prepare)
    if (verdict.kind === 'unopenable') { setNotice(UNOPENABLE); return }
    if (verdict.kind === 're-take') { setNotice(TOO_SMALL); return }
    setNotice(verdict.notice)
    onReadDocument(docType, verdict.image)
  }

  return (
    <div
      className="mb-3 rounded-xl border border-divider bg-surface p-4 shadow-card"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void handle(e.dataTransfer.files?.[0]) }}
    >
      <p className="m-0 text-[13px] font-semibold">{DOC_LABEL[docType]}</p>
      <p className="mb-3 mt-0.5 text-[12px] text-text-muted">
        {vettedCopy('upload_hint')}
      </p>
      <label
        htmlFor="opening-upload"
        className="inline-flex cursor-pointer items-center rounded-full bg-primary px-4 py-2 text-[14px] font-semibold text-surface"
      >
        Upload photo
      </label>
      <input
        id="opening-upload"
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => { void handle(e.target.files?.[0]) }}
      />
      <p className="mb-0 mt-2 text-[12px] text-text-muted">
        {vettedCopy('opening_upload_alternative')}
      </p>
      {notice && <p role="status" className="mb-0 mt-2 text-[12px]">{notice}</p>}
    </div>
  )
}
```

In `ConversationShell.tsx`, directly after the opening-beat paragraphs:

```tsx
      <OpeningUploadCard state={state} onReadDocument={onReadDocument} />
```

(`onReadDocument` is already in the shell's props via `BlockHandlers`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/ui/chat/OpeningUploadCard.test.tsx` — expected: 3 passing.
Run: `pnpm test` — expected: green. `ConversationShell` tests render the shell with a fresh state, so the card now appears there; they select by specific labels, so no collisions — if one asserts on the whole DOM, scope it.
Sabotage check: delete the `state.documents.some(...)` guard → the third test fails → restore.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add -A && git commit -m "feat(chat): opening license-upload card on the shared intake path"
```

---

### Task 5: Composer with attach

**Files:**
- Create: `src/ui/chat/Composer.tsx`
- Modify: `src/ui/chat/ConversationShell.tsx` (replace inline form; keep footer/suggestions)
- Test: `tests/ui/chat/Composer.test.tsx`

**Interfaces:**
- Consumes: `judgeFile`, `DOC_LABEL`, `TOO_SMALL`, `UNOPENABLE` from `@/ui/upload/intake` (Task 4); `documentsToUpload`; `vettedCopy('composer_placeholder')` (Task 2).
- Produces: `Composer({ sendable, onSend, state, onReadDocument, prepare? })`. `onSend(text: string)` is the shell's existing `send`; the shell keeps ownership of `Suggestions`, the thinking indicator, and `useIdleNudge`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/chat/Composer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from '@/ui/chat/Composer'
import { createApplication, applicationReducer } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}
const DEALER_PROFILE: ApplicantProfile = {
  ...PROFILE,
  licenses: ['dealer'],
}

const IMAGE: PreparedImage = {
  imageBase64: 'aGk=', imageUrl: 'data:image/png;base64,aGk=',
  imageSize: { width: 1600, height: 1000 },
}
const prepare = async () => IMAGE

function renderComposer(state: ApplicationState, over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    sendable: true, onSend: vi.fn(), onReadDocument: vi.fn(), state, prepare,
    ...over,
  }
  render(<Composer {...props} />)
  return props
}

describe('Composer', () => {
  it('sends trimmed text and clears the draft', async () => {
    const { onSend } = renderComposer(createApplication('app-1', PROFILE, 'o'))
    const input = screen.getByLabelText(/tell the agent something/i)
    await userEvent.type(input, '  hello  ')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(input).toHaveValue('')
  })

  it('with one outstanding document, attach is a direct file input that routes it', async () => {
    const { onReadDocument } = renderComposer(createApplication('app-1', PROFILE, 'o'))
    const input = screen.getByLabelText(/attach a photo of your driver's license/i)
    await userEvent.upload(input, new File(['x'], 'dl.png', { type: 'image/png' }))
    expect(onReadDocument).toHaveBeenCalledWith('drivers_license', IMAGE)
  })

  it('with several outstanding documents, attach opens a chooser', async () => {
    const { onReadDocument } = renderComposer(createApplication('app-1', DEALER_PROFILE, 'o'))
    await userEvent.click(screen.getByRole('button', { name: /attach a document/i }))
    const input = screen.getByLabelText(/photo of your dealer license/i)
    await userEvent.upload(input, new File(['x'], 'dealer.png', { type: 'image/png' }))
    expect(onReadDocument).toHaveBeenCalledWith('dealer_license', IMAGE)
  })

  it('hides attach entirely once every document is read', () => {
    const base = createApplication('app-1', PROFILE, 'o')
    const state = applicationReducer(base, {
      type: 'RECORD_DOCUMENT', documentId: 'doc-1',
      docType: 'drivers_license', at: '2026-08-05T00:00:00.000Z',
    })
    renderComposer(state)
    expect(screen.queryByLabelText(/attach/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull()
  })

  it('never carries the disabled attribute, only aria-disabled', () => {
    renderComposer(createApplication('app-1', PROFILE, 'o'), { sendable: false })
    const send = screen.getByRole('button', { name: /send/i })
    expect(send).not.toBeDisabled()
    expect(send).toHaveAttribute('aria-disabled', 'true')
  })
})
```

(`licenses` is `readonly LicenseType[]`, `LicenseType = 'dealer' | 'dismantler' | 'exporter' | 'salvage'` — a dealer license makes `documentsToUpload` return two documents, which is what the chooser test needs.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test tests/ui/chat/Composer.test.tsx`
Expected: FAIL — cannot resolve `@/ui/chat/Composer`.

- [ ] **Step 3: Implement Composer**

`src/ui/chat/Composer.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { documentsToUpload } from '@/domain/requirements/documents'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { DOC_LABEL, TOO_SMALL, UNOPENABLE, judgeFile } from '@/ui/upload/intake'

type Props = {
  sendable: boolean
  onSend: (text: string) => void
  state: ApplicationState
  onReadDocument: (docType: DocType, image: PreparedImage) => void
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}

const PAPERCLIP = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
)

export function Composer({ sendable, onSend, state, onReadDocument, prepare }: Props) {
  const [draft, setDraft] = useState('')
  const [chooserOpen, setChooserOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const outstanding = documentsToUpload(state.profile)
    .filter((t) => !state.documents.some((d) => d.docType === t))

  const handleFile = async (docType: DocType, file: File | undefined) => {
    if (!file) return
    setNotice(null)
    setChooserOpen(false)
    const verdict = await judgeFile(file, prepare)
    if (verdict.kind === 'unopenable') { setNotice(UNOPENABLE); return }
    if (verdict.kind === 're-take') { setNotice(TOO_SMALL); return }
    setNotice(verdict.notice)
    onReadDocument(docType, verdict.image)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!sendable) return
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    onSend(text)
  }

  return (
    <div>
      {notice && <p role="status" className="mb-2 mt-0 text-[12px]">{notice}</p>}
      {chooserOpen && outstanding.length > 1 && (
        <div className="mb-2 flex flex-col gap-1 rounded-xl border border-divider bg-surface p-2 shadow-card">
          {outstanding.map((docType) => (
            <span key={docType}>
              <label
                htmlFor={`composer-attach-${docType}`}
                className="block cursor-pointer rounded-lg px-3 py-1.5 text-[13px] hover:bg-page"
              >
                {DOC_LABEL[docType]}
              </label>
              <input
                id={`composer-attach-${docType}`}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => { void handleFile(docType, e.target.files?.[0]) }}
              />
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={submit}
        className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-2 py-1.5 shadow-card"
      >
        {outstanding.length === 1 && (
          <>
            <label
              htmlFor="composer-attach"
              aria-label={`Attach a ${DOC_LABEL[outstanding[0]].toLowerCase()}`}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary hover:bg-page"
            >
              {PAPERCLIP}
            </label>
            <input
              id="composer-attach"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => { void handleFile(outstanding[0], e.target.files?.[0]) }}
            />
          </>
        )}
        {outstanding.length > 1 && (
          <button
            type="button"
            aria-label="Attach a document"
            aria-expanded={chooserOpen}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text-secondary hover:bg-page"
            onClick={() => setChooserOpen((open) => !open)}
          >
            {PAPERCLIP}
          </button>
        )}

        <label htmlFor="chat-composer" className="sr-only">
          Tell the agent something
        </label>
        <input
          id="chat-composer"
          value={draft}
          placeholder={vettedCopy('composer_placeholder')}
          className="w-full border-none bg-transparent text-[15px] outline-none placeholder:text-text-muted"
          onChange={(event) => setDraft(event.target.value)}
        />

        <button
          type="submit"
          aria-label="Send"
          aria-disabled={!sendable || draft.trim() === ''}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-surface ${
            !sendable || draft.trim() === '' ? 'bg-primary opacity-60' : 'cursor-pointer bg-primary'
          }`}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21 23 12 2 3v7l15 2-15 2v7Z" />
          </svg>
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Slim ConversationShell to use it**

In `ConversationShell.tsx`: delete `draft`/`setDraft`, the `submit` handler, `composerRowStyle`, `composerStyle`, and the whole `<form>`; in the footer render instead:

```tsx
        <Composer
          sendable={sendable}
          onSend={send}
          state={state}
          onReadDocument={onReadDocument}
        />
```

`footerStyle` becomes `className="sticky bottom-0 flex flex-col gap-2 bg-page pb-5"` on the footer div.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/ui/chat/Composer.test.tsx` — expected: 5 passing.
Run: `pnpm test` — expected: green. The shell tests type into `Tell the agent something` and click `Send`; both selectors survive. The attach input now also exists in those renders — if a test uses an over-broad selector, tighten the selector, not the feature.
Sabotage check: make `submit` skip the `sendable` guard → the §9.1-style shell test for refused sends fails → restore.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add -A && git commit -m "feat(chat): claude-style composer with document attach"
```

---

### Task 6: Full verification — suite, types, and a real applicant's walk

**Files:** none created; this task gates the branch.

- [ ] **Step 1: Full suite and typecheck**

Run: `pnpm test` — expected: all green (965 existing + new).
Run: `pnpm typecheck` — expected: exit 0, no output. Paste both outputs.

- [ ] **Step 2: Drive the app as a real applicant**

This step needs the Chrome tools — the main session performs it, not a subagent. Reuse the dev server on :3000 (`lsof -i :3000` first; the "N" circle in screenshots is the Next.js dev badge, not an app element).

1. Load `http://localhost:3000` fresh. Confirm: branded header, warm page, opening beat as typeset prose, the license card visible without scrolling, Claude-style composer with paperclip and red send.
2. Upload `sample/licenses/specimens/dc_2018.png` via the opening card's **Upload photo**. Confirm the card disappears after the read, the agent's turn arrives, and fields fill.
3. Reload a fresh application; this time attach the same file through the composer paperclip. Confirm the same read flow.
4. Send a text message; confirm bubbles render right-aligned neutral, agent replies with the avatar gutter.
5. Screenshot before/after for Kaly.

- [ ] **Step 3: Commit any verification fixes, report**

Fix-forward anything the walk exposes (fix, don't defer), re-run `pnpm test` and `pnpm typecheck`, commit.
