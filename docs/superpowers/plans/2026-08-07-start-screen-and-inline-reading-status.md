# Start Screen with Docking Composer + Inline Reading Status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A centered hero start screen (greeting, license-upload card, suggestion cards, large composer) that docks into the normal conversation layout on the applicant's first action via the View Transitions API, plus the "Reading your photo…" status rendered inline in the upload card.

**Architecture:** `ConversationShell` derives a latching `started` flag from existing state and renders one of two layouts around a single always-mounted `Composer`. The dock animation wraps the first action's state update in `document.startViewTransition` (instant swap without the API or under reduced motion). `useApplication` grows a doc-type-aware `readingDocTypes` array; `OpeningUploadCard` swaps its upload control for a status row while its own doc type is in flight, and the shell's floating line covers only reads no visible card shows.

**Tech Stack:** Next.js / React 18, Tailwind v4, vitest + @testing-library/react (jsdom), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-08-07-start-screen-and-inline-reading-status-design.md`

## Global Constraints

- COPY_VERSION becomes `'8'` exactly; every applicant-visible fixed agent string resolves through `vettedCopy(id)` — never a literal in a component (chrome strings like "Thinking…" are the existing, deliberate exception).
- `opening_beat` STAYS in the copy catalog (the agent can still emit it as a `notice` block — `tests/server/orchestrator/prompt.test.ts` depends on it); only the shell stops rendering it.
- §9.1: never DOM-disable a control that can hold focus; refuse the action instead. Never steal focus on update. Upload surfaces are hidden, not disabled, once submitted.
- The composer must be the same mounted DOM element in both layouts — the shell's two stable children (content wrapper, composer wrapper) must not be restructured.
- Code comments: short and sparse, constraint-stating only.
- Test commands: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`. Paste the actual output of both in each task's report — a clean typecheck leaves no trace in a diff, so show it.
- Commit after every task. Message prefixes as in `git log` (`feat(ui):`, `test(ui):`, `fix(...):`).

## File Structure

- Modify `src/domain/orchestrator/copy.ts` — add `start_headline`, `start_subline`; COPY_VERSION `'8'`.
- Modify `src/ui/client/useApplication.ts` — `readingDocTypes: readonly DocType[]` replaces the private count (the derived `readingDocument` boolean is removed in Task 7 when its last consumer goes).
- Create `src/ui/chat/StatusLine.tsx` — the shared dots-status paragraph + `READING_PHOTO` text.
- Modify `src/ui/chat/OpeningUploadCard.tsx` — `readingDocTypes` + `variant` props, inline status, `view-transition-name: upload-card`.
- Modify `src/ui/chat/Suggestions.tsx` — extract `suggestionTexts()` for reuse.
- Create `src/ui/chat/StartScreen.tsx` — greeting + card row (upload card + suggestion cards).
- Create `src/ui/chat/dock-transition.ts` — `withViewTransition()` guard/fallback.
- Modify `src/ui/chat/Composer.tsx` — `size: 'docked' | 'hero'` prop.
- Modify `src/ui/chat/ConversationShell.tsx` — latching `started`, two layouts, docking wrappers, floating-line logic.
- Modify `src/app/page.tsx` — pass `readingDocTypes`.
- Tests: `tests/domain/orchestrator/copy.test.ts`, `tests/ui/client/useApplication.test.ts` (new), `tests/ui/chat/OpeningUploadCard.test.tsx`, `tests/ui/chat/StartScreen.test.tsx` (new), `tests/ui/chat/dock-transition.test.ts` (new), `tests/ui/chat/Composer.test.tsx`, `tests/ui/chat/ConversationShell.test.tsx`.

---

### Task 1: Start-screen copy keys

**Files:**
- Modify: `src/domain/orchestrator/copy.ts`
- Test: `tests/domain/orchestrator/copy.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `vettedCopy('start_headline')`, `vettedCopy('start_subline')` (Tasks 4, 7); `COPY_VERSION === '8'`.

- [ ] **Step 1: Write the failing test**

In `tests/domain/orchestrator/copy.test.ts`, replace the `'carries the section-flow copy under version 7'` test with (same position):

```ts
  it('still carries the section-flow copy', () => {
    expect(vettedCopy('done_chip')).toBe("Done with this section — what's next?")
    expect(vettedCopy('section_incomplete')).toBe(
      "A few answers in this section are still blank — they're marked below.",
    )
  })

  it('carries the start-screen copy under version 8', () => {
    expect(COPY_VERSION).toBe('8')
    expect(vettedCopy('start_headline')).toBe("Hi — let's get you set up to bid at IAA.")
    expect(vettedCopy('start_subline')).toBe(
      "I'm your registration agent. I'll ask a few things and fill in what I can "
      + "from your documents — the fastest start is your driver's license.",
    )
  })
```

Leave the `'carries the opening beat verbatim from the spec'` test untouched — the key stays in the catalog.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/orchestrator/copy.test.ts`
Expected: FAIL — `start_headline` is not a `VettedCopyId` (type error surfaces as a failed run) / COPY_VERSION is `'7'`.

- [ ] **Step 3: Implement**

In `src/domain/orchestrator/copy.ts`:

1. `export const COPY_VERSION = '8'`
2. Add to `ALL_COPY_IDS` after `'opening_beat'`:

```ts
  'start_headline',
  'start_subline',
```

3. Add to `COPY` after the `opening_beat` entry:

```ts
  start_headline: "Hi — let's get you set up to bid at IAA.",

  start_subline:
    "I'm your registration agent. I'll ask a few things and fill in what I can "
    + "from your documents — the fastest start is your driver's license.",
```

- [ ] **Step 4: Run the copy test, then the whole suite**

Run: `npx vitest run tests/domain/orchestrator/copy.test.ts`
Expected: PASS

Run: `npx vitest run`
Expected: PASS. If any other test hardcodes version `'7'` or a shown-copy hash derived from it, fix that test now — find candidates with `grep -rn "COPY_VERSION\|'7'" tests/`.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/domain/orchestrator/copy.ts tests/domain/orchestrator/copy.test.ts
git commit -m "feat(copy): start-screen headline and subline, COPY_VERSION 8"
```

---

### Task 2: `readingDocTypes` in useApplication

**Files:**
- Modify: `src/ui/client/useApplication.ts`
- Test: `tests/ui/client/useApplication.test.ts` (new)

**Interfaces:**
- Consumes: existing `sendDocument` API shapes.
- Produces: `UseApplication.readingDocTypes: readonly DocType[]` — doc types queued or fetching, one entry per in-flight read. `readingDocument: boolean` still present and derived (`readingDocTypes.length > 0`); it is removed in Task 7.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/client/useApplication.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useApplication } from '@/ui/client/useApplication'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

const IMAGE: PreparedImage = {
  imageBase64: 'aGk=', imageUrl: 'data:image/png;base64,aGk=',
  imageSize: { width: 1600, height: 1000 },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

/** Start answers at once; each document read stays open until the test settles it. */
let settleRead: Array<(r: Response) => void>

function stubFetch(state: unknown) {
  settleRead = []
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/documents')) {
      return new Promise<Response>((resolve) => { settleRead.push(resolve) })
    }
    return Promise.resolve(json(state))
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('useApplication readingDocTypes', () => {
  it('lists a doc type for exactly its in-flight window', async () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    stubFetch(state)
    const { result } = renderHook(() => useApplication())
    await waitFor(() => expect(result.current.state).not.toBeNull())

    expect(result.current.readingDocTypes).toEqual([])
    act(() => { result.current.readDocument('drivers_license', IMAGE) })
    await waitFor(() =>
      expect(result.current.readingDocTypes).toEqual(['drivers_license']))

    act(() => {
      settleRead[0]!(json({ band: 'full', documentId: 'doc-1', filled: [], state }))
    })
    await waitFor(() => expect(result.current.readingDocTypes).toEqual([]))
  })

  it('keeps a second read listed while the first settles', async () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    stubFetch(state)
    const { result } = renderHook(() => useApplication())
    await waitFor(() => expect(result.current.state).not.toBeNull())

    act(() => {
      result.current.readDocument('drivers_license', IMAGE)
      result.current.readDocument('dealer_license', IMAGE)
    })
    await waitFor(() => expect(result.current.readingDocTypes)
      .toEqual(['drivers_license', 'dealer_license']))

    act(() => {
      settleRead[0]!(json({ band: 'full', documentId: 'doc-1', filled: [], state }))
    })
    await waitFor(() =>
      expect(result.current.readingDocTypes).toEqual(['dealer_license']))
  })

  it('drops the doc type when the read fails, too', async () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    stubFetch(state)
    const { result } = renderHook(() => useApplication())
    await waitFor(() => expect(result.current.state).not.toBeNull())

    act(() => { result.current.readDocument('drivers_license', IMAGE) })
    await waitFor(() =>
      expect(result.current.readingDocTypes).toEqual(['drivers_license']))

    act(() => { settleRead[0]!(json({ error: 'nope' }, 502)) })
    await waitFor(() => expect(result.current.readingDocTypes).toEqual([]))
  })
})
```

Note: the second reads queue behind the first (`enqueue`), but the doc type is listed at call time — that is the behavior under test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/client/useApplication.test.ts`
Expected: FAIL — `readingDocTypes` does not exist.

- [ ] **Step 3: Implement**

In `src/ui/client/useApplication.ts`:

1. In the `UseApplication` type, under the `readingDocument` line, add:

```ts
  /** One entry per in-flight read — the doc types queued or fetching. */
  readingDocTypes: readonly DocType[]
```

2. Replace the `readingCount` state (keep the existing comment, reworded for the array):

```ts
  // An array, not a flag: nothing here disables an upload input mid-read, so
  // a second photo can be chosen while the first is still in flight — and the
  // card for one doc type must not read as busy because another one is.
  const [readingDocs, setReadingDocs] = useState<readonly DocType[]>([])
```

3. In `readDocument`, replace `setReadingCount((n) => n + 1)` with:

```ts
    setReadingDocs((held) => [...held, docType])
```

and the `finally` block's `setReadingCount((n) => n - 1)` with:

```ts
        setReadingDocs((held) => {
          const at = held.indexOf(docType)
          return [...held.slice(0, at), ...held.slice(at + 1)]
        })
```

4. In the returned object, replace `readingDocument: readingCount > 0,` with:

```ts
    readingDocument: readingDocs.length > 0, readingDocTypes: readingDocs,
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/client/useApplication.test.ts && npx vitest run`
Expected: PASS (all — the derived boolean keeps existing behavior).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/ui/client/useApplication.ts tests/ui/client/useApplication.test.ts
git commit -m "feat(ui): track in-flight document reads by doc type"
```

---

### Task 3: StatusLine + inline reading status in OpeningUploadCard

**Files:**
- Create: `src/ui/chat/StatusLine.tsx`
- Modify: `src/ui/chat/OpeningUploadCard.tsx`
- Test: `tests/ui/chat/OpeningUploadCard.test.tsx`

**Interfaces:**
- Consumes: `DocType` from `@/domain/field-id`.
- Produces: `StatusLine({ text, className? })` and `READING_PHOTO` (Task 7 uses both); `OpeningUploadCard` props gain `readingDocTypes?: readonly DocType[]` (default `[]`) and `variant?: 'opening' | 'card'` (default `'opening'`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/ui/chat/OpeningUploadCard.test.tsx`:

```ts
  it('shows the reading status in place of the upload control while its photo is read', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(
      <OpeningUploadCard
        state={state} onReadDocument={vi.fn()} prepare={prepare}
        readingDocTypes={['drivers_license']}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/reading your photo/i)
    expect(screen.queryByLabelText(/upload photo/i)).toBeNull()
  })

  it('keeps the upload control when a different doc type is being read', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(
      <OpeningUploadCard
        state={state} onReadDocument={vi.fn()} prepare={prepare}
        readingDocTypes={['dealer_license']}
      />,
    )

    expect(screen.getByLabelText(/upload photo/i)).toBeInTheDocument()
    expect(screen.queryByText(/reading your photo/i)).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/chat/OpeningUploadCard.test.tsx`
Expected: FAIL — unknown prop is ignored by React, so the first new test fails on "found the upload control".

- [ ] **Step 3: Create StatusLine and rework the card**

Create `src/ui/chat/StatusLine.tsx`:

```tsx
export const READING_PHOTO = 'Reading your photo…'

/** The one shape every in-flight status takes — dots, then words. */
export function StatusLine({
  text, className = 'my-2 text-[13px] text-text-secondary',
}: { text: string; className?: string }) {
  return (
    <p role="status" className={className}>
      <span aria-hidden="true" style={{ letterSpacing: 2 }}>•••</span>{' '}
      {text}
    </p>
  )
}
```

In `src/ui/chat/OpeningUploadCard.tsx`:

1. Import `{ READING_PHOTO, StatusLine }` from `'./StatusLine'`.
2. Extend props:

```ts
type Props = {
  state: ApplicationState
  onReadDocument: (docType: DocType, image: PreparedImage) => void
  /** Doc types with a read in flight — this card goes quiet for its own. */
  readingDocTypes?: readonly DocType[]
  /** 'card' drops the stack margin for the start screen's grid row. */
  variant?: 'opening' | 'card'
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}
```

3. Destructure `readingDocTypes = [], variant = 'opening'` and compute `const reading = readingDocTypes.includes(docType)` (after the early returns).
4. Wrapper div: className becomes `` `${variant === 'opening' ? 'mb-3 ' : ''}rounded-xl border border-divider bg-surface p-4 shadow-card` `` and gains `style={{ viewTransitionName: 'upload-card' }}` — the same name in both layouts is what lets the browser animate the card from the start row to the top of the log.
5. Swap the upload control for the status while reading — replace the `<label htmlFor="opening-upload">…</label>` + `<input id="opening-upload" …/>` pair with:

```tsx
      {reading ? (
        <StatusLine text={READING_PHOTO} className="m-0 text-[13px] text-text-secondary" />
      ) : (
        <>
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
        </>
      )}
```

The title, hint, alternative line, and notice stay put; drag-and-drop while reading is also refused — guard `handle` with `if (reading) return` at the top.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/chat/OpeningUploadCard.test.tsx`
Expected: PASS (new and pre-existing).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/ui/chat/StatusLine.tsx src/ui/chat/OpeningUploadCard.tsx tests/ui/chat/OpeningUploadCard.test.tsx
git commit -m "feat(ui): reading status inline in the upload card"
```

---

### Task 4: `suggestionTexts` extraction + StartScreen

**Files:**
- Modify: `src/ui/chat/Suggestions.tsx`
- Create: `src/ui/chat/StartScreen.tsx`
- Test: `tests/ui/chat/StartScreen.test.tsx` (new)

**Interfaces:**
- Consumes: `OpeningUploadCard` with `variant="card"` + `readingDocTypes` (Task 3); `vettedCopy('start_headline' | 'start_subline')` (Task 1).
- Produces: `suggestionTexts(fieldIds: readonly RequirementKey[]): string[]`; `StartScreen({ state, fieldIds, disabled, onPick, onReadDocument, readingDocTypes, prepare? })` (Task 7 renders it).

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/chat/StartScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StartScreen } from '@/ui/chat/StartScreen'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

const props = {
  fieldIds: ['first_name', 'last_name', 'email'] as const,
  disabled: false,
  onPick: vi.fn(),
  onReadDocument: vi.fn(),
  readingDocTypes: [] as const,
}

describe('StartScreen', () => {
  it('greets with the vetted headline and offers the license card', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} />)

    expect(screen.getByRole('heading', { name: /set up to bid at IAA/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/upload photo/i)).toBeInTheDocument()
  })

  it('offers at most three things to say, and sends a picked one as intent', async () => {
    const onPick = vi.fn()
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} onPick={onPick} />)

    const cards = screen.getAllByRole('button', { name: /why do you|what else/i })
    expect(cards.length).toBeLessThanOrEqual(3)

    await userEvent.click(screen.getByRole('button', { name: /what else do you need/i }))
    expect(onPick).toHaveBeenCalledWith('What else do you need?')
  })

  it('hides the suggestion cards while sending is unavailable', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} disabled />)

    expect(screen.queryByRole('button', { name: /what else do you need/i })).toBeNull()
    expect(screen.getByLabelText(/upload photo/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/chat/StartScreen.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Extract `suggestionTexts` and build StartScreen**

In `src/ui/chat/Suggestions.tsx`, lift the wording out of the component (the existing comment about question-shaped labels moves with it):

```ts
/**
 * A question-shaped label ("Which ID will you use?") already carries its
 * own question mark and reads as nonsense lowercased into "need my…" — it
 * is quoted back instead, so nothing is folded or doubled.
 */
export function suggestionTexts(fieldIds: readonly RequirementKey[]): string[] {
  const asks = fieldIds.slice(0, 2).map((id) => {
    const label = displayLabel(id)
    return label.endsWith('?') ? `Why do you ask “${label}”` : `Why do you need my ${label.toLowerCase()}?`
  })
  return [...asks, 'What else do you need?']
}
```

and have `Suggestions` map over `suggestionTexts(fieldIds)` instead of its inline `asks`/`offers`.

Create `src/ui/chat/StartScreen.tsx`:

```tsx
'use client'

import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import type { RequirementKey } from '@/domain/requirements/key'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { OpeningUploadCard } from './OpeningUploadCard'
import { suggestionTexts } from './Suggestions'

type Props = {
  state: ApplicationState
  /** The fields still outstanding, most relevant first. */
  fieldIds: readonly RequirementKey[]
  /** Hidden, not greyed out, while sending is unavailable (§9.1). */
  disabled: boolean
  onPick: (text: string) => void
  onReadDocument: (docType: DocType, image: PreparedImage) => void
  readingDocTypes: readonly DocType[]
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}

const cardClass =
  'cursor-pointer rounded-xl border border-divider bg-surface p-3 text-left '
  + 'text-[13px] text-text-secondary shadow-card hover:bg-page'

/**
 * The first thing a new applicant sees: a greeting, the license card, and a
 * few things to say. Gone for good after the first action docks the composer.
 */
export function StartScreen({
  state, fieldIds, disabled, onPick, onReadDocument, readingDocTypes, prepare,
}: Props) {
  return (
    <div className="flex flex-col gap-5" style={{ viewTransitionName: 'start-hero' }}>
      <div>
        <h1 className="m-0 text-[32px] font-semibold leading-tight">
          {vettedCopy('start_headline')}
        </h1>
        <p className="mb-0 mt-2 text-[15px] text-text-secondary">
          {vettedCopy('start_subline')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OpeningUploadCard
          state={state}
          onReadDocument={onReadDocument}
          readingDocTypes={readingDocTypes}
          variant="card"
          {...(prepare && { prepare })}
        />
        {!disabled && suggestionTexts(fieldIds).slice(0, 3).map((text) => (
          <button key={text} type="button" className={cardClass} onClick={() => onPick(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/chat/StartScreen.test.tsx tests/ui/chat/Suggestions.test.tsx`
Expected: PASS — including the untouched Suggestions tests, which prove the extraction changed nothing.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/ui/chat/Suggestions.tsx src/ui/chat/StartScreen.tsx tests/ui/chat/StartScreen.test.tsx
git commit -m "feat(ui): start-screen hero with license card and suggestion cards"
```

---

### Task 5: `withViewTransition` helper

**Files:**
- Create: `src/ui/chat/dock-transition.ts`
- Test: `tests/ui/chat/dock-transition.test.ts` (new)

**Interfaces:**
- Consumes: `flushSync` from `react-dom`.
- Produces: `withViewTransition(update: () => void): void` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/chat/dock-transition.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { withViewTransition } from '@/ui/chat/dock-transition'

type VTDocument = Document & { startViewTransition?: (cb: () => void) => unknown }
const doc = document as VTDocument

afterEach(() => {
  delete doc.startViewTransition
  vi.restoreAllMocks()
})

describe('withViewTransition', () => {
  it('runs the update directly when the platform has no view transitions', () => {
    // jsdom has no startViewTransition — this IS the fallback path.
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('routes the update through startViewTransition when it exists', () => {
    const calls: string[] = []
    doc.startViewTransition = vi.fn((cb: () => void) => { calls.push('vt'); cb() })
    withViewTransition(() => calls.push('update'))
    expect(calls).toEqual(['vt', 'update'])
  })

  it('skips the animation under reduced motion, but still updates', () => {
    doc.startViewTransition = vi.fn()
    vi.spyOn(window, 'matchMedia').mockReturnValue(
      { matches: true } as MediaQueryList,
    )
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(doc.startViewTransition).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/chat/dock-transition.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/ui/chat/dock-transition.ts`:

```ts
import { flushSync } from 'react-dom'

/**
 * Runs a layout-flipping update through the View Transitions API where the
 * platform has it — an instant swap under reduced motion or without the API.
 * flushSync is what puts the new layout in the DOM inside the transition's
 * snapshot window.
 */
export function withViewTransition(update: () => void): void {
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  document.startViewTransition(() => { flushSync(update) })
}
```

(`startViewTransition` is in the project's TS DOM lib — no ambient declaration needed.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/chat/dock-transition.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/ui/chat/dock-transition.ts tests/ui/chat/dock-transition.test.ts
git commit -m "feat(ui): view-transition wrapper for the dock flip"
```

---

### Task 6: Composer `size` prop

**Files:**
- Modify: `src/ui/chat/Composer.tsx`
- Test: `tests/ui/chat/Composer.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Composer` accepts `size?: 'docked' | 'hero'` (default `'docked'`); Task 7 passes `hero` on the start screen.

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/chat/Composer.test.tsx` (reuse the file's existing render helpers/state fixtures):

```tsx
  it('grows to the hero size on request, docked by default', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    const { container, rerender } = render(
      <Composer sendable onSend={vi.fn()} state={state} onReadDocument={vi.fn()} />,
    )
    expect(container.querySelector('form')?.className).toContain('rounded-2xl')

    rerender(
      <Composer sendable onSend={vi.fn()} state={state} onReadDocument={vi.fn()} size="hero" />,
    )
    expect(container.querySelector('form')?.className).toContain('rounded-3xl')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/chat/Composer.test.tsx`
Expected: FAIL — hero class never appears.

- [ ] **Step 3: Implement**

In `src/ui/chat/Composer.tsx`:

```ts
type Size = 'docked' | 'hero'

const FORM_CLASS: Record<Size, string> = {
  docked: 'flex items-center gap-2 rounded-2xl border border-border bg-surface px-2 py-1.5 shadow-card',
  hero: 'flex items-center gap-2 rounded-3xl border border-border bg-surface px-3 py-4 shadow-card',
}
```

Add `size?: Size` to `Props`, destructure `size = 'docked'`, and set the form's `className={FORM_CLASS[size]}`. Nothing else changes — same input, same buttons, same handlers.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/chat/Composer.test.tsx`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/ui/chat/Composer.tsx tests/ui/chat/Composer.test.tsx
git commit -m "feat(ui): hero-size composer variant"
```

---

### Task 7: ConversationShell layouts, latch, and wiring

**Files:**
- Modify: `src/ui/chat/ConversationShell.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/ui/client/useApplication.ts` (remove the now-unconsumed `readingDocument` boolean)
- Test: `tests/ui/chat/ConversationShell.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `ConversationShell` props swap `readingDocument: boolean` for `readingDocTypes: readonly DocType[]`; `UseApplication` loses `readingDocument`.

- [ ] **Step 1: Update existing tests and write the failing ones**

In `tests/ui/chat/ConversationShell.test.tsx`:

1. Import `DocType`: `import type { DocType } from '@/domain/field-id'`. In `noHandlers`, replace `readingDocument: boolean` / `readingDocument: false` with `readingDocTypes: readonly DocType[]` / `readingDocTypes: []`.
2. Rewrite the first two tests — the greeting replaces the beat:

```tsx
  it('renders the start greeting before any turn exists, with no fetch at all', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.getByRole('heading', { name: /set up to bid at IAA/i })).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('cannot render the greeting via a model call — the copy is local, not fetched', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    const state = createApplication('app-1', PROFILE, OWNER)

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.getByRole('heading', { name: /set up to bid at IAA/i })).toBeInTheDocument()
  })
```

3. Replace the two `reading-document status line` tests with the doc-type-aware set, and add the start/dock tests:

```tsx
  it('starts centered and docks on the first send', async () => {
    const applicantTurn: Turn = { seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'Hi' }
    const agentTurn: Turn = { seq: 2, at: AT, role: 'agent', voice: 'Hello!', blocks: [] }
    const state = createApplication('app-1', PROFILE, OWNER)
    const after: ApplicationState = { ...state, transcript: [applicantTurn, agentTurn] }

    stubFetch((call) =>
      call.url.endsWith('/turn')
        ? { status: 200, body: { state: after, turn: agentTurn } }
        : { status: 200, body: after },
    )

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    expect(screen.getByRole('heading', { name: /set up to bid/i })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    // The optimistic echo alone docks the layout — before the agent answers.
    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
    expect(screen.getByRole('log')).toBeInTheDocument()
    await screen.findByText('Hello!')
  })

  it('docks when the first photo starts reading, status shown on the card alone', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)

    const { rerender } = render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    rerender(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} readingDocTypes={['drivers_license']}
      />,
    )

    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
    // Inline on the card, and nowhere else.
    expect(screen.getAllByText(/reading your photo/i)).toHaveLength(1)
    expect(screen.queryByLabelText(/upload photo/i)).toBeNull()
  })

  it('stays docked after a failed first read leaves nothing behind', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const state = createApplication('app-1', PROFILE, OWNER)

    const { rerender } = render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )
    rerender(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} readingDocTypes={['drivers_license']}
      />,
    )
    rerender(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
  })

  it('floats the reading line for a read no visible card shows', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const base = createApplication('app-1', PROFILE, OWNER)
    const state = applicationReducer(base, {
      type: 'RECORD_DOCUMENT', documentId: 'doc-1',
      docType: 'drivers_license', at: AT,
    })

    render(
      <ConversationShell
        applicationId="app-1" ownerToken={OWNER} state={state}
        {...noHandlers} readingDocTypes={['dealer_license']}
      />,
    )

    expect(screen.getByText(/reading your photo/i)).toBeInTheDocument()
  })

  it('a resumed conversation never sees the start screen', () => {
    stubFetch(() => ({ status: 200, body: {} }))
    const turn: Turn = { seq: 1, at: AT, role: 'agent', voice: 'Welcome back.', blocks: [] }
    const base = createApplication('app-1', PROFILE, OWNER)
    const state: ApplicationState = { ...base, transcript: [turn] }

    render(
      <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
    )

    expect(screen.queryByRole('heading', { name: /set up to bid/i })).toBeNull()
  })

  it('runs the first action through a view transition when the platform has one', async () => {
    type VTDocument = Document & { startViewTransition?: (cb: () => void) => unknown }
    const doc = document as VTDocument
    const vt = vi.fn((cb: () => void) => { cb() })
    doc.startViewTransition = vt
    try {
      stubFetch(() => ({ status: 200, body: {} }))
      const state = createApplication('app-1', PROFILE, OWNER)

      render(
        <ConversationShell applicationId="app-1" ownerToken={OWNER} state={state} {...noHandlers} />,
      )
      await userEvent.type(screen.getByLabelText(/tell the agent something/i), 'Hi')
      await userEvent.click(screen.getByRole('button', { name: /send/i }))

      expect(vt).toHaveBeenCalledTimes(1)
    } finally {
      delete doc.startViewTransition
    }
  })
```

Add `applicationReducer` to the reducer import.

- [ ] **Step 2: Run test to verify the new ones fail**

Run: `npx vitest run tests/ui/chat/ConversationShell.test.tsx`
Expected: FAIL — no heading exists, `readingDocTypes` is not a prop.

- [ ] **Step 3: Rework the shell**

In `src/ui/chat/ConversationShell.tsx`:

1. Imports: drop `vettedCopy`; add:

```ts
import type { DocType } from '@/domain/field-id'
import { documentsToUpload } from '@/domain/requirements/documents'
import { withViewTransition } from './dock-transition'
import { StartScreen } from './StartScreen'
import { StatusLine, READING_PHOTO } from './StatusLine'
```

2. Props: replace `readingDocument: boolean` with:

```ts
  /** Doc types with a read in flight — queued or fetching. */
  readingDocTypes: readonly DocType[]
```

3. Styles — keep `shellStyle` and `logStyle`, add:

```ts
/** The start screen centres the same column instead of growing a log. */
const startShellStyle: React.CSSProperties = {
  ...shellStyle, justifyContent: 'center', paddingBottom: 24,
}

/** Docked only: grows so the sticky composer stays pinned below the log. */
const contentStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
}
```

4. Inside the component, after `suggestible`:

```ts
  const startedNow = turns.length > 0 || state.transcript.length > 0
    || state.documents.length > 0 || readingDocTypes.length > 0 || pending
    || state.submittedAt !== null
  // Latches: a failed first read — nothing committed, nothing pending — must
  // not un-dock the screen (spec §1).
  const startedRef = useRef(startedNow)
  if (startedNow) startedRef.current = true
  const started = startedRef.current

  // First action docks the layout, animated where the platform allows.
  // Composer refuses empty drafts before onSend, so a blank send never docks.
  const dockOn = <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (startedRef.current) { fn(...args); return }
      startedRef.current = true
      withViewTransition(() => fn(...args))
    }
  const sendDocking = dockOn(send)
  const readDocking = dockOn(onReadDocument)

  // A read shown on the visible card is not repeated as a floating line.
  const cardDocType = documentsToUpload(state.profile)[0]!
  const cardVisible = state.submittedAt === null
    && !state.documents.some((d) => d.docType === cardDocType)
  const floatingReads = readingDocTypes.filter((t) => !(cardVisible && t === cardDocType))
```

5. Replace the returned JSX. The section keeps exactly two children — content wrapper and composer wrapper — so the composer never remounts across the flip:

```tsx
  return (
    <section aria-label="Registration agent" style={started ? shellStyle : startShellStyle}>
      <div style={started ? contentStyle : undefined}>
        {started ? (
          <>
            <OpeningUploadCard
              state={state} onReadDocument={readDocking} readingDocTypes={readingDocTypes}
            />

            {/* Polite and coalesced, per §9.1: a turn arriving must not interrupt
                whatever the applicant is doing, and must never steal focus. */}
            <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" style={logStyle}>
              {turns.map((turn) => (
                <TurnView
                  key={turn.seq}
                  turn={turn}
                  state={state}
                  onChange={blockChange}
                  onClear={blockClear}
                  onConfirm={blockConfirm}
                  onReadDocument={readDocking}
                />
              ))}
            </div>

            {/* The OCR read is multi-second and otherwise silent. Only reads no
                visible card is already showing land here. */}
            {floatingReads.length > 0 && <StatusLine text={READING_PHOTO} />}

            {/* The agent's slot, held while it thinks. Not a spinner for its own
                sake: a turn is one to ten seconds, and an empty screen after the
                composer clears reads as an app that dropped what you said. */}
            {pending && <StatusLine text="Thinking…" />}

            <SectionDoneBar state={state} turns={turns} sendable={sendable} onDone={sendDone} />

            <CompletionCard state={state} onSubmit={onSubmit} />
          </>
        ) : (
          <StartScreen
            state={state}
            fieldIds={suggestible}
            disabled={!sendable}
            onPick={sendDocking}
            onReadDocument={readDocking}
            readingDocTypes={readingDocTypes}
          />
        )}
      </div>

      <div
        className={started ? 'sticky bottom-0 flex flex-col gap-2 bg-page pb-5' : 'mt-5'}
        style={{ viewTransitionName: 'composer' }}
      >
        {started && (
          <Suggestions fieldIds={suggestible} disabled={!sendable} onPick={sendDocking} />
        )}
        <Composer
          size={started ? 'docked' : 'hero'}
          sendable={sendable}
          onSend={sendDocking}
          state={state}
          onReadDocument={readDocking}
        />
      </div>
    </section>
  )
```

6. In `src/app/page.tsx`: `readingDocument={app.readingDocument}` becomes `readingDocTypes={app.readingDocTypes}`.
7. In `src/ui/client/useApplication.ts`: delete the `readingDocument` member from the `UseApplication` type and the returned object — `readingDocTypes` is its replacement and the page was its only consumer.

- [ ] **Step 4: Run the shell tests, then everything**

Run: `npx vitest run tests/ui/chat/ConversationShell.test.tsx`
Expected: PASS — including every pre-existing test (composer flows start on the hero screen and dock on send).

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — paste output.

```bash
git add src/ui/chat/ConversationShell.tsx src/app/page.tsx src/ui/client/useApplication.ts tests/ui/chat/ConversationShell.test.tsx
git commit -m "feat(ui): centered start screen that docks on the first action"
```

---

### Task 8: Full verification + Chrome walk

**Files:** none new — verification only. Fix anything found (fix, don't defer) and commit fixes.

- [ ] **Step 1: Full suite and typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`. Paste both outputs. Both must be clean.

- [ ] **Step 2: Chrome walk**

Start the dev server (`npm run dev`, log to a file; model turns can take 30–90s — wait on the log's POST lines, not the spinner). Walk as a real user:

1. Fresh load → centered layout: headline "Hi — let's get you set up to bid at IAA.", subline, license card + up to three suggestion cards, hero composer. No log, no chips, no Done bar.
2. Type a message and send → the composer visibly animates to the bottom; greeting and cards are gone; the optimistic echo and then the agent turn appear; the upload card sits at the top of the log.
3. Reload (fresh application), click a suggestion card → same dock, the suggestion's text sent as the first turn.
4. Reload, upload a license photo from the start-screen card → dock fires; the card at the top of the log shows "Reading your photo…" inline with no floating duplicate; on commit the card disappears and the section presentation arrives.
5. OS reduced-motion on (System Settings → Accessibility → Display → Reduce motion) → the flip is an instant swap.

Record a GIF of walk 2 or 4 if convenient. Report what was seen honestly — including anything off.

- [ ] **Step 3: Close out**

Fix any defects found (with tests where they were test-shaped misses), commit, and re-run the suite. Then report completion with the final test count and typecheck output.
