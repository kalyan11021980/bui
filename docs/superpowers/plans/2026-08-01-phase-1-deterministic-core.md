# Phase 1 — Deterministic Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the compliance core of the IAA buyer registration rebuild — a field catalog where every field must justify itself, a deterministic requirements engine, application state with provenance, an append-only audit log, and a panel UI that can complete a whole registration on its own.

**Architecture:** Everything here is pure and deterministic. No LLM, no network calls, no OCR. A `FieldDef` cannot be constructed without `purpose` and `authority`, so the "always tell the user why" rule is enforced by the type system rather than by discipline. The requirements engine maps an applicant profile to the exact set of fields that applicant owes, and is the only authority on what "complete" means. Application state is a reducer over typed actions, and every transition emits an audit event.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5 (strict), Zod 3, Vitest 2, @testing-library/react, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-01-iaa-genui-registration-design.md` (Phase 1 of §15)

## Global Constraints

- **No LLM in this phase.** No `ai` package, no model calls, no network I/O anywhere in `src/domain/`.
- **`purpose` and `authority` are non-optional on every `FieldDef`** (spec §9). Enforced by types and by a CI test.
- **`sensitive: true` and `orchestratorVisible: true` are mutually exclusive** (spec §8.1). Enforced at compile time.
- **The audit log never stores raw values for `sensitive` fields** — digest only (spec §10.1).
- **Undo is scoped to pre-submission drafts only.** Confirmations are corrected by a new logged event, never reversed (spec §10.1).
- **Red never means error.** Error is `#E87830` (orange); `#B82018` is the brand primary (spec §9).
- **Never disable the primary button** — keep it at full `#B82018` and show what is outstanding beside it (spec §9).
- **Address, legal name and taxpayer ID are never bulk-confirmed** — each needs an individual confirmation (spec §10.4).
- All domain code is pure: same input, same output, no `Date.now()` inside reducers — timestamps are passed in.

---

## File Structure

```
package.json · tsconfig.json · next.config.ts · vitest.config.ts
src/
  domain/
    authority.ts              Authority union + display labels
    field-id.ts               FieldId union + DocType
    field-def.ts              FieldDef type, defineField, compile-time exclusivity
    catalog/
      identity.ts             name, DOB, ID form, DL number/expiry, ID images
      address.ts              country, line1/2, city, state, zip
      contact.ts              mobile, primary phone
      business.ts             business name, legal name, business address
      license.ts              type, number, effective, expiry, country, image
      tax.ts                  taxpayer ID
      gsa.ts                  bidder number, fleet email
      index.ts                CATALOG map + lookup helpers
    requirements/
      version.ts              RULES_VERSION
      rules.ts                per-profile requirement rules
      engine.ts               requiredFields / outstandingFields / isComplete
    application/
      state.ts                FieldState, Provenance, ApplicationState types
      reducer.ts              pure transitions
      carry.ts                CARRY_RULES + applyCarry
    audit/
      event.ts                AuditEvent types + digest
      log.ts                  append-only log
  ui/
    theme/tokens.ts           measured IAA palette
    panel/
      FieldRow.tsx            one field in all six statuses
      Rationale.tsx           purpose/authority/handling display
      ProgressSummary.tsx     "4 of 11 left" + never-disabled CTA
      ApplicationPanel.tsx    composes the above
  app/
    page.tsx                  panel host
    api/application/route.ts  GET/POST application state
tests/  (mirrors src/)
```

---

### Task 1: Scaffold + the rationale-enforcing FieldDef

This is the keystone. When it's done, it is impossible to add a field to this
system without saying what it's for and who requires it.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`
- Create: `src/domain/authority.ts`, `src/domain/field-id.ts`, `src/domain/field-def.ts`
- Test: `tests/domain/field-def.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Authority`, `AUTHORITY_LABEL`, `FieldId`, `DocType`, `FieldType`, `FieldDef<T>`, `defineField<T>(def: FieldDef<T>): FieldDef<T>`

- [ ] **Step 1: Create the project files**

`package.json`:

```json
{
  "name": "buyersui",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "incremental": true,
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
```

`next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default nextConfig
```

`tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Then run `npm install`.

- [ ] **Step 2: Write the failing test**

`tests/domain/field-def.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineField } from '@/domain/field-def'
import { AUTHORITY_LABEL } from '@/domain/authority'

describe('defineField', () => {
  it('returns the definition it was given', () => {
    const f = defineField({
      id: 'first_name',
      label: 'First name',
      type: 'text',
      purpose: 'So your account matches your government ID',
      authority: 'FEDERAL_KYC',
      validation: z.string().min(1),
    })
    expect(f.id).toBe('first_name')
    expect(f.purpose).not.toBe('')
    expect(f.authority).toBe('FEDERAL_KYC')
  })

  it('rejects an empty purpose at runtime', () => {
    expect(() =>
      defineField({
        id: 'first_name',
        label: 'First name',
        type: 'text',
        purpose: '   ',
        authority: 'FEDERAL_KYC',
        validation: z.string(),
      }),
    ).toThrow(/purpose/i)
  })

  it('rejects a sensitive field that is also orchestrator-visible', () => {
    expect(() =>
      defineField({
        id: 'tax_id',
        label: 'Taxpayer ID',
        type: 'taxid',
        purpose: 'So we can pay you when your vehicle sells',
        authority: 'IRS',
        validation: z.string(),
        sensitive: true,
        // @ts-expect-error compile-time exclusivity is the primary guard
        orchestratorVisible: true,
      }),
    ).toThrow(/orchestratorVisible/)
  })

  it('has a display label for every authority', () => {
    for (const [key, label] of Object.entries(AUTHORITY_LABEL)) {
      expect(label, key).not.toBe('')
    }
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/domain/field-def.test.ts`
Expected: FAIL — cannot resolve `@/domain/field-def`.

- [ ] **Step 4: Write the implementation**

`src/domain/authority.ts`:

```ts
export type Authority =
  | 'IRS'
  | 'FEDERAL_KYC'
  | 'STATE_DMV'
  | 'STATE_DEALER_BOARD'
  | 'GSA'
  | 'IAA_POLICY'

export const AUTHORITY_LABEL: Record<Authority, string> = {
  IRS: 'the IRS',
  FEDERAL_KYC: 'federal identity rules',
  STATE_DMV: 'your state DMV',
  STATE_DEALER_BOARD: 'your state dealer board',
  GSA: 'GSA Fleet',
  IAA_POLICY: 'IAA',
}
```

`src/domain/field-id.ts`:

```ts
export type FieldId =
  // profile
  | 'applicant_type' | 'primary_activity' | 'preferred_language'
  | 'profile_country' | 'profile_state'
  // identity
  | 'first_name' | 'last_name' | 'id_form' | 'dl_number' | 'dl_expiry'
  | 'dob' | 'id_images'
  // personal address
  | 'addr_line1' | 'addr_line2' | 'addr_city' | 'addr_state' | 'addr_zip'
  // contact
  | 'phone_mobile' | 'phone_primary'
  // business
  | 'biz_name' | 'biz_legal_name'
  | 'biz_addr_line1' | 'biz_addr_line2' | 'biz_addr_city'
  | 'biz_addr_state' | 'biz_addr_zip' | 'biz_phone'
  // license
  | 'license_type' | 'license_number' | 'license_effective'
  | 'license_expiry' | 'license_image'
  // tax
  | 'tax_id'
  // gsa
  | 'gsa_bidder_number' | 'gsa_email'

export type DocType =
  | 'drivers_license'
  | 'state_id'
  | 'passport'
  | 'dealer_license'
```

`src/domain/field-def.ts`:

```ts
import type { ZodType } from 'zod'
import type { Authority } from './authority'
import type { DocType, FieldId } from './field-id'

export type FieldType =
  | 'text' | 'date' | 'select' | 'phone' | 'address' | 'file' | 'taxid'

type FieldDefBase<T> = {
  id: FieldId
  label: string
  type: FieldType
  /** What this is FOR, in the user's terms. Required. */
  purpose: string
  /** WHO requires it. Required. */
  authority: Authority
  /** Vetted, legally reviewed. Never model-generated. */
  consequence?: string
  /** Privacy answer, shown by default on sensitive fields. */
  handling?: string
  /** Where the value lands, e.g. "W-9, line 1". */
  destination?: string
  validation: ZodType<T>
  derivableFrom?: readonly DocType[]
}

/**
 * `sensitive` and `orchestratorVisible` are mutually exclusive (spec §8.1):
 * a value the orchestrator may see is by definition not sensitive.
 */
export type FieldDef<T = unknown> =
  | (FieldDefBase<T> & { sensitive: true; orchestratorVisible?: never })
  | (FieldDefBase<T> & { sensitive?: false; orchestratorVisible?: boolean })

export function defineField<T>(def: FieldDef<T>): FieldDef<T> {
  if (def.purpose.trim() === '') {
    throw new Error(`Field "${def.id}": purpose must not be empty`)
  }
  if (def.label.trim() === '') {
    throw new Error(`Field "${def.id}": label must not be empty`)
  }
  if (def.sensitive === true && 'orchestratorVisible' in def &&
      (def as { orchestratorVisible?: boolean }).orchestratorVisible === true) {
    throw new Error(
      `Field "${def.id}": sensitive fields cannot set orchestratorVisible`,
    )
  }
  return def
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/domain/field-def.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Verify types compile**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts next.config.ts tests/setup.ts \
  src/domain/authority.ts src/domain/field-id.ts src/domain/field-def.ts \
  tests/domain/field-def.test.ts
git commit -m "feat: scaffold project and add rationale-enforcing FieldDef"
```

---

### Task 2: Identity, address and contact catalog entries

**Files:**
- Create: `src/domain/catalog/identity.ts`, `src/domain/catalog/address.ts`, `src/domain/catalog/contact.ts`
- Test: `tests/domain/catalog/personal.test.ts`

**Interfaces:**
- Consumes: `defineField`, `FieldDef`, `FieldId` from Task 1
- Produces: `IDENTITY_FIELDS`, `ADDRESS_FIELDS`, `CONTACT_FIELDS` — each `readonly FieldDef[]`

- [ ] **Step 1: Write the failing test**

`tests/domain/catalog/personal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { IDENTITY_FIELDS } from '@/domain/catalog/identity'
import { ADDRESS_FIELDS } from '@/domain/catalog/address'
import { CONTACT_FIELDS } from '@/domain/catalog/contact'

describe('personal catalog', () => {
  const all = [...IDENTITY_FIELDS, ...ADDRESS_FIELDS, ...CONTACT_FIELDS]

  it('gives every field a non-empty purpose and an authority', () => {
    for (const f of all) {
      expect(f.purpose.trim(), f.id).not.toBe('')
      expect(f.authority, f.id).toBeTruthy()
    }
  })

  it('marks the DL number as derivable from a driver licence', () => {
    const dl = IDENTITY_FIELDS.find((f) => f.id === 'dl_number')
    expect(dl?.derivableFrom).toContain('drivers_license')
  })

  it('validates a date of birth as an ISO date', () => {
    const dob = IDENTITY_FIELDS.find((f) => f.id === 'dob')
    expect(dob?.validation.safeParse('1982-08-31').success).toBe(true)
    expect(dob?.validation.safeParse('31/08/1982').success).toBe(false)
  })

  it('rejects a malformed zip code', () => {
    const zip = ADDRESS_FIELDS.find((f) => f.id === 'addr_zip')
    expect(zip?.validation.safeParse('30301').success).toBe(true)
    expect(zip?.validation.safeParse('3O3O1').success).toBe(false)
  })

  it('gives handling copy to every sensitive field', () => {
    for (const f of all.filter((x) => x.sensitive)) {
      expect(f.handling?.trim(), f.id).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/catalog/personal.test.ts`
Expected: FAIL — cannot resolve `@/domain/catalog/identity`.

- [ ] **Step 3: Write the implementation**

`src/domain/catalog/identity.ts`:

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

export const IDENTITY_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'first_name',
    label: 'First name',
    type: 'text',
    purpose: 'Your account has to match the name on your ID',
    authority: 'FEDERAL_KYC',
    validation: z.string().min(1, 'Enter your first name'),
    derivableFrom: ['drivers_license', 'state_id', 'passport'],
    orchestratorVisible: true,
  }),
  defineField({
    id: 'last_name',
    label: 'Last name',
    type: 'text',
    purpose: 'Your account has to match the name on your ID',
    authority: 'FEDERAL_KYC',
    validation: z.string().min(1, 'Enter your last name'),
    derivableFrom: ['drivers_license', 'state_id', 'passport'],
  }),
  defineField({
    id: 'id_form',
    label: 'Form of identification',
    type: 'select',
    purpose: 'Tells us which document to check your details against',
    authority: 'FEDERAL_KYC',
    validation: z.enum(['drivers_license', 'state_id', 'passport']),
  }),
  defineField({
    id: 'dl_number',
    label: "Driver's license number",
    type: 'text',
    purpose: 'Confirms the ID you uploaded belongs to you',
    authority: 'STATE_DMV',
    handling: 'Encrypted at rest. Never shown to other bidders.',
    validation: z.string().min(4, 'Enter the number shown on your license'),
    derivableFrom: ['drivers_license'],
    sensitive: true,
  }),
  defineField({
    id: 'dl_expiry',
    label: 'ID expiration date',
    type: 'date',
    purpose: 'We cannot accept an expired ID',
    authority: 'FEDERAL_KYC',
    consequence: 'An expired ID will be rejected during review.',
    validation: isoDate,
    derivableFrom: ['drivers_license', 'state_id', 'passport'],
  }),
  defineField({
    id: 'dob',
    label: 'Date of birth',
    type: 'date',
    purpose: 'Confirms you are old enough to bid',
    authority: 'FEDERAL_KYC',
    validation: isoDate,
    derivableFrom: ['drivers_license', 'state_id', 'passport'],
    sensitive: true,
    handling: 'Used only to verify your age and identity.',
  }),
  defineField({
    id: 'id_images',
    label: 'Photos of your ID',
    type: 'file',
    purpose: 'A person on our team compares these to what you entered',
    authority: 'FEDERAL_KYC',
    handling: 'Stored encrypted and visible only to Buyer Services.',
    validation: z.array(z.string().min(1)).min(1, 'Upload at least one image'),
    sensitive: true,
  }),
]
```

`src/domain/catalog/address.ts`:

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const zipSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP code')

export const ADDRESS_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'addr_line1',
    label: 'Address',
    type: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your street address'),
    derivableFrom: ['drivers_license'],
  }),
  defineField({
    id: 'addr_line2',
    label: 'Address line 2',
    type: 'text',
    purpose: 'Apartment or suite, if you have one',
    authority: 'IAA_POLICY',
    validation: z.string().optional(),
  }),
  defineField({
    id: 'addr_city',
    label: 'City',
    type: 'text',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your city'),
    derivableFrom: ['drivers_license'],
  }),
  defineField({
    id: 'addr_state',
    label: 'State',
    type: 'select',
    purpose: 'Bidding rules and required documents differ by state',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().length(2, 'Select your state'),
    derivableFrom: ['drivers_license'],
    orchestratorVisible: true,
  }),
  defineField({
    id: 'addr_zip',
    label: 'ZIP code',
    type: 'text',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: zipSchema,
    derivableFrom: ['drivers_license'],
  }),
]
```

`src/domain/catalog/contact.ts`:

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const phoneSchema = z
  .string()
  .regex(/^\+?1?\d{10}$/, 'Enter a 10-digit phone number')

export const CONTACT_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'phone_mobile',
    label: 'Mobile phone',
    type: 'phone',
    purpose: 'So we can text you the moment your account is approved',
    authority: 'IAA_POLICY',
    validation: phoneSchema,
  }),
  defineField({
    id: 'phone_primary',
    label: 'Daytime phone',
    type: 'phone',
    purpose: 'How Buyer Services reaches you if a document needs fixing',
    authority: 'IAA_POLICY',
    validation: phoneSchema.optional(),
  }),
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/catalog/personal.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/catalog tests/domain/catalog
git commit -m "feat: add identity, address and contact catalog entries"
```

---

### Task 3: Business, license, tax and GSA entries + the catalog index

**Files:**
- Create: `src/domain/catalog/business.ts`, `src/domain/catalog/license.ts`, `src/domain/catalog/tax.ts`, `src/domain/catalog/gsa.ts`, `src/domain/catalog/index.ts`
- Test: `tests/domain/catalog/index.test.ts`

**Interfaces:**
- Consumes: `defineField`, `FieldDef`, `FieldId`; `zipSchema` from `catalog/address`; `phoneSchema` from `catalog/contact`
- Produces: `BUSINESS_FIELDS`, `LICENSE_FIELDS`, `TAX_FIELDS`, `GSA_FIELDS`, `CATALOG: ReadonlyMap<FieldId, FieldDef>`, `fieldDef(id: FieldId): FieldDef`

- [ ] **Step 1: Write the failing test**

`tests/domain/catalog/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CATALOG, fieldDef, ALL_FIELDS } from '@/domain/catalog'

describe('catalog index', () => {
  it('has no duplicate field ids', () => {
    const ids = ALL_FIELDS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires purpose and authority on every field — the §9 guarantee', () => {
    for (const f of ALL_FIELDS) {
      expect(f.purpose.trim(), f.id).not.toBe('')
      expect(f.authority, f.id).toBeTruthy()
    }
  })

  it('never marks a sensitive field orchestrator-visible', () => {
    for (const f of ALL_FIELDS) {
      if (f.sensitive) {
        expect(
          (f as { orchestratorVisible?: boolean }).orchestratorVisible,
          f.id,
        ).not.toBe(true)
      }
    }
  })

  it('looks a field up by id', () => {
    expect(fieldDef('tax_id').authority).toBe('IRS')
    expect(CATALOG.size).toBe(ALL_FIELDS.length)
  })

  it('throws on an unknown id', () => {
    // @ts-expect-error deliberately invalid
    expect(() => fieldDef('nope')).toThrow(/unknown field/i)
  })

  it('gives the taxpayer ID handling copy, since it is the scariest ask', () => {
    const tax = fieldDef('tax_id')
    expect(tax.sensitive).toBe(true)
    expect(tax.handling?.trim()).toBeTruthy()
    expect(tax.destination).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/catalog/index.test.ts`
Expected: FAIL — cannot resolve `@/domain/catalog`.

- [ ] **Step 3: Write the implementation**

`src/domain/catalog/business.ts`:

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'
import { zipSchema } from './address'
import { phoneSchema } from './contact'

export const BUSINESS_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'biz_name',
    label: 'Business name',
    type: 'text',
    purpose: 'The name buyers and sellers will see on your account',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your business name'),
  }),
  defineField({
    id: 'biz_legal_name',
    label: 'Business legal name',
    type: 'text',
    purpose: 'Must match the name on your dealer license exactly',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'A mismatch is the most common reason registration is delayed.',
    destination: 'W-9, line 1',
    validation: z.string().min(1, 'Enter the legal name'),
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'biz_addr_line1',
    label: 'Business address',
    type: 'address',
    purpose: 'Where your dealer license is registered',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(1, 'Enter the business address'),
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'biz_addr_line2',
    label: 'Business address line 2',
    type: 'text',
    purpose: 'Suite or unit, if you have one',
    authority: 'IAA_POLICY',
    validation: z.string().optional(),
  }),
  defineField({
    id: 'biz_addr_city',
    label: 'Business city',
    type: 'text',
    purpose: 'Where your dealer license is registered',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(1, 'Enter the city'),
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'biz_addr_state',
    label: 'Business state',
    type: 'select',
    purpose: 'Determines which dealer license we need from you',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().length(2, 'Select a state'),
    derivableFrom: ['dealer_license'],
    orchestratorVisible: true,
  }),
  defineField({
    id: 'biz_addr_zip',
    label: 'Business ZIP code',
    type: 'text',
    purpose: 'Where your dealer license is registered',
    authority: 'STATE_DEALER_BOARD',
    validation: zipSchema,
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'biz_phone',
    label: 'Business phone',
    type: 'phone',
    purpose: 'How Buyer Services reaches your business',
    authority: 'IAA_POLICY',
    validation: phoneSchema,
  }),
]
```

`src/domain/catalog/license.ts`:

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

export const LICENSE_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'license_type',
    label: 'License type',
    type: 'select',
    purpose: 'Different licenses unlock different vehicle categories',
    authority: 'STATE_DEALER_BOARD',
    validation: z.enum(['dealer', 'dismantler', 'exporter', 'salvage']),
  }),
  defineField({
    id: 'license_number',
    label: 'License number',
    type: 'text',
    purpose: 'We verify this against your state dealer board',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(3, 'Enter the license number'),
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_effective',
    label: 'License effective date',
    type: 'date',
    purpose: 'Confirms the license is currently active',
    authority: 'STATE_DEALER_BOARD',
    validation: isoDate,
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_expiry',
    label: 'License expiration date',
    type: 'date',
    purpose: 'We will remind you before it lapses so bidding never stops',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'Bidding is suspended automatically when a license expires.',
    validation: isoDate,
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_image',
    label: 'Photo of your license',
    type: 'file',
    purpose: 'A person on our team checks it against your state board record',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string().min(1)).min(1, 'Upload your license'),
  }),
]
```

`src/domain/catalog/tax.ts`:

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const TAX_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'tax_id',
    label: 'Taxpayer ID (SSN or EIN)',
    type: 'taxid',
    purpose: 'So we can pay you when a vehicle you consign sells',
    authority: 'IRS',
    consequence:
      'The IRS requires a taxpayer ID on Form W-9. Without one, backup withholding may apply to your proceeds.',
    handling:
      'Encrypted at rest, masked in our systems, and never shown to other bidders.',
    destination: 'W-9, Part I',
    validation: z
      .string()
      .regex(/^(\d{3}-?\d{2}-?\d{4}|\d{2}-?\d{7})$/, 'Enter an SSN or EIN'),
    sensitive: true,
  }),
]
```

`src/domain/catalog/gsa.ts`:

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const GSA_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'gsa_bidder_number',
    label: 'GSA bidder number',
    type: 'text',
    purpose: 'Links your GSA Fleet account so you can bid on government vehicles',
    authority: 'GSA',
    consequence: 'Skip this and you simply will not see GSA lots.',
    validation: z.string().min(1, 'Enter your GSA bidder number'),
  }),
  defineField({
    id: 'gsa_email',
    label: 'GSA fleet email address',
    type: 'text',
    purpose: 'Must match the email on your GSA Fleet account',
    authority: 'GSA',
    validation: z.string().email('Enter the email on your GSA account'),
  }),
]
```

`src/domain/catalog/index.ts`:

```ts
import type { FieldDef } from '../field-def'
import type { FieldId } from '../field-id'
import { IDENTITY_FIELDS } from './identity'
import { ADDRESS_FIELDS } from './address'
import { CONTACT_FIELDS } from './contact'
import { BUSINESS_FIELDS } from './business'
import { LICENSE_FIELDS } from './license'
import { TAX_FIELDS } from './tax'
import { GSA_FIELDS } from './gsa'

export const ALL_FIELDS: readonly FieldDef[] = [
  ...IDENTITY_FIELDS,
  ...ADDRESS_FIELDS,
  ...CONTACT_FIELDS,
  ...BUSINESS_FIELDS,
  ...LICENSE_FIELDS,
  ...TAX_FIELDS,
  ...GSA_FIELDS,
]

export const CATALOG: ReadonlyMap<FieldId, FieldDef> = new Map(
  ALL_FIELDS.map((f) => [f.id, f]),
)

export function fieldDef(id: FieldId): FieldDef {
  const def = CATALOG.get(id)
  if (!def) throw new Error(`Unknown field: ${String(id)}`)
  return def
}

export {
  IDENTITY_FIELDS, ADDRESS_FIELDS, CONTACT_FIELDS,
  BUSINESS_FIELDS, LICENSE_FIELDS, TAX_FIELDS, GSA_FIELDS,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/catalog/index.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/catalog tests/domain/catalog
git commit -m "feat: complete field catalog with business, license, tax and GSA"
```

---

### Task 4: Requirements engine

The compliance surface. This gets the heaviest test coverage in the codebase.

**Files:**
- Create: `src/domain/requirements/version.ts`, `src/domain/requirements/rules.ts`, `src/domain/requirements/engine.ts`
- Test: `tests/domain/requirements/engine.test.ts`

**Interfaces:**
- Consumes: `FieldId`, `CATALOG`
- Produces: `RULES_VERSION: number`, `ApplicantProfile`, `requiredFields(profile): FieldId[]`

- [ ] **Step 1: Write the failing test**

`tests/domain/requirements/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { requiredFields } from '@/domain/requirements/engine'
import { CATALOG } from '@/domain/catalog'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const base: ApplicantProfile = {
  applicantType: 'individual',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenseCount: 0,
}

describe('requiredFields', () => {
  it('asks an individual for identity, address and mobile', () => {
    const ids = requiredFields(base)
    expect(ids).toContain('first_name')
    expect(ids).toContain('dob')
    expect(ids).toContain('addr_line1')
    expect(ids).toContain('phone_mobile')
  })

  it('never asks an individual for business or license fields', () => {
    const ids = requiredFields(base)
    expect(ids).not.toContain('biz_legal_name')
    expect(ids).not.toContain('license_number')
  })

  it('asks a business for business and license fields', () => {
    const ids = requiredFields({
      ...base,
      applicantType: 'business',
      licenseCount: 1,
    })
    expect(ids).toContain('biz_name')
    expect(ids).toContain('biz_legal_name')
    expect(ids).toContain('license_number')
    expect(ids).toContain('license_expiry')
  })

  it('asks a business for a taxpayer ID and an individual not', () => {
    expect(requiredFields({ ...base, applicantType: 'business' }))
      .toContain('tax_id')
    expect(requiredFields(base)).not.toContain('tax_id')
  })

  it('adds GSA fields only when the applicant wants GSA', () => {
    expect(requiredFields(base)).not.toContain('gsa_bidder_number')
    expect(requiredFields({ ...base, wantsGsa: true }))
      .toContain('gsa_bidder_number')
  })

  it('omits optional fields — line 2 is never required', () => {
    const ids = requiredFields({ ...base, applicantType: 'business' })
    expect(ids).not.toContain('addr_line2')
    expect(ids).not.toContain('biz_addr_line2')
  })

  it('returns no duplicates', () => {
    const ids = requiredFields({
      ...base,
      applicantType: 'business',
      wantsGsa: true,
      licenseCount: 2,
    })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns only ids that exist in the catalog', () => {
    const profiles: ApplicantProfile[] = [
      base,
      { ...base, applicantType: 'business', licenseCount: 1 },
      { ...base, wantsGsa: true },
      { ...base, state: null },
    ]
    for (const p of profiles) {
      for (const id of requiredFields(p)) {
        expect(CATALOG.has(id), `catalog is missing ${id}`).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/requirements/engine.test.ts`
Expected: FAIL — cannot resolve `@/domain/requirements/engine`.

- [ ] **Step 3: Write the implementation**

`src/domain/requirements/version.ts`:

```ts
/** Bump whenever `rules.ts` changes what an applicant owes. See spec §8.5. */
export const RULES_VERSION = 1
```

`src/domain/requirements/rules.ts`:

```ts
import type { FieldId } from '../field-id'

export type ApplicantProfile = {
  applicantType: 'business' | 'individual'
  country: string
  /** Two-letter code, or null before the applicant has told us. */
  state: string | null
  wantsGsa: boolean
  licenseCount: number
}

export const CORE_IDENTITY: readonly FieldId[] = [
  'first_name', 'last_name', 'id_form', 'dl_number', 'dl_expiry',
  'dob', 'id_images',
]

export const CORE_ADDRESS: readonly FieldId[] = [
  'addr_line1', 'addr_city', 'addr_state', 'addr_zip',
]

export const CORE_CONTACT: readonly FieldId[] = ['phone_mobile']

export const BUSINESS_CORE: readonly FieldId[] = [
  'biz_name', 'biz_legal_name',
  'biz_addr_line1', 'biz_addr_city', 'biz_addr_state', 'biz_addr_zip',
  'biz_phone',
]

export const LICENSE_CORE: readonly FieldId[] = [
  'license_type', 'license_number', 'license_effective',
  'license_expiry', 'license_image',
]

export const GSA_CORE: readonly FieldId[] = ['gsa_bidder_number', 'gsa_email']
```

`src/domain/requirements/engine.ts`:

```ts
import type { FieldId } from '../field-id'
import {
  BUSINESS_CORE, CORE_ADDRESS, CORE_CONTACT, CORE_IDENTITY,
  GSA_CORE, LICENSE_CORE, type ApplicantProfile,
} from './rules'

/**
 * The single authority on what an applicant owes. Pure: same profile in,
 * same field list out. No LLM, no I/O. See spec §8.
 */
export function requiredFields(profile: ApplicantProfile): FieldId[] {
  const out: FieldId[] = [
    ...CORE_IDENTITY,
    ...CORE_ADDRESS,
    ...CORE_CONTACT,
  ]

  if (profile.applicantType === 'business') {
    out.push(...BUSINESS_CORE, 'tax_id')
    if (profile.licenseCount > 0) out.push(...LICENSE_CORE)
  }

  if (profile.wantsGsa) out.push(...GSA_CORE)

  return [...new Set(out)]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/requirements/engine.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/requirements tests/domain/requirements
git commit -m "feat: add deterministic requirements engine"
```

---

### Task 5: Application state and reducer

**Files:**
- Create: `src/domain/application/state.ts`, `src/domain/application/reducer.ts`
- Test: `tests/domain/application/reducer.test.ts`

**Interfaces:**
- Consumes: `FieldId`, `ApplicantProfile`, `RULES_VERSION`
- Produces: `FieldStatus`, `ProvenanceSource`, `Provenance`, `FieldState`, `ApplicationState`, `Action`, `createApplication(id, profile)`, `applicationReducer(state, action)`, `outstandingFields(state)`, `isComplete(state)`

- [ ] **Step 1: Write the failing test**

`tests/domain/application/reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const profile: ApplicantProfile = {
  applicantType: 'individual',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenseCount: 0,
}

const AT = '2026-08-01T12:00:00.000Z'

describe('applicationReducer', () => {
  it('starts with every required field outstanding', () => {
    const s = createApplication('app-1', profile)
    expect(outstandingFields(s).length).toBeGreaterThan(0)
    expect(isComplete(s)).toBe(false)
  })

  it('records a value with its provenance', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT, confidence: 0.97, documentId: 'doc-1',
    })
    expect(s.fields.first_name?.value).toBe('Kalyan')
    expect(s.fields.first_name?.status).toBe('derived')
    expect(s.fields.first_name?.provenance?.source).toBe('ocr')
    expect(s.fields.first_name?.provenance?.confidence).toBe(0.97)
  })

  it('marks a user-entered value confirmed immediately', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(s.fields.first_name?.status).toBe('confirmed')
  })

  it('moves a derived field to confirmed when the user confirms it', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'dob', value: '1982-08-31',
      source: 'ocr', at: AT,
    })
    s = applicationReducer(s, {
      type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'abc123',
    })
    expect(s.fields.dob?.status).toBe('confirmed')
  })

  it('refuses to confirm a field that has no value', () => {
    const s = createApplication('app-1', profile)
    expect(() =>
      applicationReducer(s, {
        type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'abc',
      }),
    ).toThrow(/no value/i)
  })

  it('rejects a field with a human-readable reason', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'id_images', value: ['img-1'],
      source: 'user', at: AT,
    })
    s = applicationReducer(s, {
      type: 'REJECT', fieldId: 'id_images', at: AT,
      reason: 'The photo was too dark to read your license number',
    })
    expect(s.fields.id_images?.status).toBe('rejected')
    expect(s.fields.id_images?.rejection?.reason).toMatch(/too dark/)
  })

  it('leaves other verified fields untouched when one is rejected', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    s = applicationReducer(s, { type: 'VERIFY', fieldId: 'first_name', at: AT })
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'id_images', value: ['img-1'],
      source: 'user', at: AT,
    })
    s = applicationReducer(s, {
      type: 'REJECT', fieldId: 'id_images', at: AT, reason: 'Too dark',
    })
    expect(s.fields.first_name?.status).toBe('verified')
  })

  it('counts a rejected field as outstanding again', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'id_images', value: ['img-1'],
      source: 'user', at: AT,
    })
    expect(outstandingFields(s)).not.toContain('id_images')
    s = applicationReducer(s, {
      type: 'REJECT', fieldId: 'id_images', at: AT, reason: 'Too dark',
    })
    expect(outstandingFields(s)).toContain('id_images')
  })

  it('is complete only when every required field is confirmed or verified', () => {
    let s = createApplication('app-1', profile)
    for (const id of outstandingFields(s)) {
      s = applicationReducer(s, {
        type: 'SET_VALUE', fieldId: id, value: 'x', source: 'user', at: AT,
      })
    }
    expect(isComplete(s)).toBe(true)
  })

  it('does not mutate the state it was given', () => {
    const s = createApplication('app-1', profile)
    const before = JSON.stringify(s)
    applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(JSON.stringify(s)).toBe(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/application/reducer.test.ts`
Expected: FAIL — cannot resolve `@/domain/application/reducer`.

- [ ] **Step 3: Write the state types**

`src/domain/application/state.ts`:

```ts
import type { FieldId } from '../field-id'
import type { ApplicantProfile } from '../requirements/rules'

export type FieldStatus =
  | 'empty' | 'derived' | 'confirmed' | 'verified' | 'rejected' | 'superseded'

export type ProvenanceSource = 'ocr' | 'user' | 'lookup' | 'carried'

export type Provenance = {
  source: ProvenanceSource
  documentId?: string
  /** Original-image coordinates. Absent when the provider cannot supply them. */
  box?: readonly [number, number, number, number]
  confidence?: number
  fromFieldId?: FieldId
}

export type FieldState<T = unknown> = {
  value: T | null
  status: FieldStatus
  provenance?: Provenance
  rejection?: { reason: string; at: string }
}

export type ApplicationState = {
  id: string
  rulesVersion: number
  profile: ApplicantProfile
  fields: Partial<Record<FieldId, FieldState>>
  submittedAt: string | null
}

export type Action =
  | {
      type: 'SET_VALUE'
      fieldId: FieldId
      value: unknown
      source: ProvenanceSource
      at: string
      documentId?: string
      box?: readonly [number, number, number, number]
      confidence?: number
      fromFieldId?: FieldId
    }
  | { type: 'CONFIRM'; fieldId: FieldId; at: string; shownCopyHash: string }
  | { type: 'VERIFY'; fieldId: FieldId; at: string }
  | { type: 'REJECT'; fieldId: FieldId; at: string; reason: string }
  | { type: 'SUPERSEDE'; fieldId: FieldId; at: string }
  | { type: 'UPDATE_PROFILE'; patch: Partial<ApplicantProfile>; at: string }
```

- [ ] **Step 4: Write the reducer**

`src/domain/application/reducer.ts`:

```ts
import type { FieldId } from '../field-id'
import { requiredFields } from '../requirements/engine'
import type { ApplicantProfile } from '../requirements/rules'
import { RULES_VERSION } from '../requirements/version'
import type { Action, ApplicationState, FieldState } from './state'

export function createApplication(
  id: string,
  profile: ApplicantProfile,
): ApplicationState {
  return {
    id,
    rulesVersion: RULES_VERSION,
    profile,
    fields: {},
    submittedAt: null,
  }
}

/** Statuses that satisfy a requirement. */
const SATISFIED: ReadonlySet<string> = new Set(['confirmed', 'verified'])

export function outstandingFields(state: ApplicationState): FieldId[] {
  return requiredFields(state.profile).filter((id) => {
    const f = state.fields[id]
    return !f || !SATISFIED.has(f.status)
  })
}

export function isComplete(state: ApplicationState): boolean {
  return outstandingFields(state).length === 0
}

export function applicationReducer(
  state: ApplicationState,
  action: Action,
): ApplicationState {
  switch (action.type) {
    case 'SET_VALUE': {
      const next: FieldState = {
        value: action.value,
        // A value the user typed is confirmed by the act of typing it.
        // A value we derived still needs their eyes on it. Spec §9.1.
        status: action.source === 'user' ? 'confirmed' : 'derived',
        provenance: {
          source: action.source,
          ...(action.documentId !== undefined && { documentId: action.documentId }),
          ...(action.box !== undefined && { box: action.box }),
          ...(action.confidence !== undefined && { confidence: action.confidence }),
          ...(action.fromFieldId !== undefined && { fromFieldId: action.fromFieldId }),
        },
      }
      return withField(state, action.fieldId, next)
    }

    case 'CONFIRM': {
      const current = state.fields[action.fieldId]
      if (!current || current.value === null) {
        throw new Error(
          `Cannot confirm "${action.fieldId}": it has no value yet`,
        )
      }
      return withField(state, action.fieldId, {
        ...current,
        status: 'confirmed',
      })
    }

    case 'VERIFY': {
      const current = requireField(state, action.fieldId, 'verify')
      return withField(state, action.fieldId, { ...current, status: 'verified' })
    }

    case 'REJECT': {
      const current = requireField(state, action.fieldId, 'reject')
      return withField(state, action.fieldId, {
        ...current,
        status: 'rejected',
        rejection: { reason: action.reason, at: action.at },
      })
    }

    case 'SUPERSEDE': {
      const current = requireField(state, action.fieldId, 'supersede')
      return withField(state, action.fieldId, {
        ...current,
        status: 'superseded',
      })
    }

    case 'UPDATE_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.patch } }
  }
}

function requireField(
  state: ApplicationState,
  id: FieldId,
  verb: string,
): FieldState {
  const f = state.fields[id]
  if (!f) throw new Error(`Cannot ${verb} "${id}": it has no value yet`)
  return f
}

function withField(
  state: ApplicationState,
  id: FieldId,
  field: FieldState,
): ApplicationState {
  return { ...state, fields: { ...state.fields, [id]: field } }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/domain/application/reducer.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add src/domain/application tests/domain/application
git commit -m "feat: add application state and pure reducer"
```

---

### Task 6: Carried provenance — the fix for triple entry

**Files:**
- Create: `src/domain/application/carry.ts`
- Test: `tests/domain/application/carry.test.ts`

**Interfaces:**
- Consumes: `ApplicationState`, `applicationReducer`, `FieldId`
- Produces: `CARRY_RULES: readonly {from: FieldId; to: FieldId}[]`, `applyCarry(state, at): ApplicationState`, `carriedFrom(state, id): FieldId | null`

- [ ] **Step 1: Write the failing test**

`tests/domain/application/carry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { applyCarry, carriedFrom } from '@/domain/application/carry'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const AT = '2026-08-01T12:00:00.000Z'
const business: ApplicantProfile = {
  applicantType: 'business',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenseCount: 1,
}

function withAddress() {
  let s = createApplication('app-1', business)
  for (const [id, v] of [
    ['addr_line1', '2345 Anywhere St'],
    ['addr_city', 'Atlanta'],
    ['addr_state', 'GA'],
    ['addr_zip', '30301'],
  ] as const) {
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: id, value: v, source: 'user', at: AT,
    })
  }
  return s
}

describe('applyCarry', () => {
  it('carries the personal address into the business address', () => {
    const s = applyCarry(withAddress(), AT)
    expect(s.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
    expect(s.fields.biz_addr_city?.value).toBe('Atlanta')
    expect(s.fields.biz_addr_zip?.value).toBe('30301')
  })

  it('marks carried values as derived, not confirmed', () => {
    const s = applyCarry(withAddress(), AT)
    expect(s.fields.biz_addr_line1?.status).toBe('derived')
  })

  it('records where a carried value came from', () => {
    const s = applyCarry(withAddress(), AT)
    expect(s.fields.biz_addr_line1?.provenance?.source).toBe('carried')
    expect(s.fields.biz_addr_line1?.provenance?.fromFieldId).toBe('addr_line1')
    expect(carriedFrom(s, 'biz_addr_line1')).toBe('addr_line1')
  })

  it('never overwrites a value the user already gave', () => {
    let s = withAddress()
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'biz_addr_city', value: 'Savannah',
      source: 'user', at: AT,
    })
    s = applyCarry(s, AT)
    expect(s.fields.biz_addr_city?.value).toBe('Savannah')
    expect(s.fields.biz_addr_city?.status).toBe('confirmed')
  })

  it('does nothing when the source field is empty', () => {
    const s = applyCarry(createApplication('app-1', business), AT)
    expect(s.fields.biz_addr_line1).toBeUndefined()
  })

  it('returns null from carriedFrom for a directly-entered field', () => {
    const s = withAddress()
    expect(carriedFrom(s, 'addr_line1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/application/carry.test.ts`
Expected: FAIL — cannot resolve `@/domain/application/carry`.

- [ ] **Step 3: Write the implementation**

`src/domain/application/carry.ts`:

```ts
import type { FieldId } from '../field-id'
import { applicationReducer } from './reducer'
import type { ApplicationState } from './state'

/**
 * Values the applicant should never have to type twice. Spec §9.
 * The current design asks for an address up to three times; these rules
 * are the fix.
 */
export const CARRY_RULES: readonly { from: FieldId; to: FieldId }[] = [
  { from: 'addr_line1', to: 'biz_addr_line1' },
  { from: 'addr_line2', to: 'biz_addr_line2' },
  { from: 'addr_city', to: 'biz_addr_city' },
  { from: 'addr_state', to: 'biz_addr_state' },
  { from: 'addr_zip', to: 'biz_addr_zip' },
  { from: 'phone_primary', to: 'biz_phone' },
]

/**
 * Copies each source value into its destination when the destination is
 * still empty. Carried values land as `derived`, so the user still gets to
 * confirm them — carrying saves typing, not attention.
 */
export function applyCarry(
  state: ApplicationState,
  at: string,
): ApplicationState {
  let next = state
  for (const rule of CARRY_RULES) {
    const source = next.fields[rule.from]
    if (!source || source.value === null || source.value === undefined) continue

    const dest = next.fields[rule.to]
    if (dest && dest.value !== null && dest.value !== undefined) continue

    next = applicationReducer(next, {
      type: 'SET_VALUE',
      fieldId: rule.to,
      value: source.value,
      source: 'carried',
      fromFieldId: rule.from,
      at,
    })
  }
  return next
}

export function carriedFrom(
  state: ApplicationState,
  id: FieldId,
): FieldId | null {
  const f = state.fields[id]
  if (!f?.provenance || f.provenance.source !== 'carried') return null
  return f.provenance.fromFieldId ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/application/carry.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/application/carry.ts tests/domain/application/carry.test.ts
git commit -m "feat: carry values forward instead of asking twice"
```

---

### Task 7: Append-only audit log

Spec §10.1. The log must capture what the user was shown at the moment they
confirmed, and must never store a raw value for a sensitive field.

**Files:**
- Create: `src/domain/audit/event.ts`, `src/domain/audit/log.ts`
- Test: `tests/domain/audit/log.test.ts`

**Interfaces:**
- Consumes: `Action`, `ApplicationState`, `FieldId`, `fieldDef`
- Produces: `AuditEvent`, `digest(input: string): string`, `AuditLog` class with `append(action, state)`, `entries()`, `size()`

- [ ] **Step 1: Write the failing test**

`tests/domain/audit/log.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AuditLog, digest } from '@/domain/audit/log'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const AT = '2026-08-01T12:00:00.000Z'
const profile: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'GA',
  wantsGsa: false, licenseCount: 1,
}

describe('AuditLog', () => {
  it('assigns sequential numbers starting at 1', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    log.append({
      type: 'SET_VALUE', fieldId: 'last_name', value: 'Chatterjee',
      source: 'user', at: AT,
    })
    expect(log.entries().map((e) => e.seq)).toEqual([1, 2])
  })

  it('stores the plain value for a non-sensitive field', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(log.entries()[0]?.value).toBe('Kalyan')
    expect(log.entries()[0]?.valueDigest).toBeUndefined()
  })

  it('stores only a digest for a sensitive field', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'tax_id', value: '123-45-6789',
      source: 'user', at: AT,
    })
    const e = log.entries()[0]
    expect(e?.value).toBeUndefined()
    expect(e?.valueDigest).toBe(digest('123-45-6789'))
    expect(JSON.stringify(log.entries())).not.toContain('123-45-6789')
  })

  it('records the copy hash the user was shown when confirming', () => {
    const log = new AuditLog()
    log.append({
      type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'copy-v3',
    })
    expect(log.entries()[0]?.shownCopyHash).toBe('copy-v3')
    expect(log.entries()[0]?.kind).toBe('confirmed')
  })

  it('refuses to mutate an entry once appended', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    const entries = log.entries()
    expect(() => {
      ;(entries as unknown as { push: (x: unknown) => void }).push({})
    }).toThrow()
    expect(log.size()).toBe(1)
  })

  it('produces a stable digest', () => {
    expect(digest('abc')).toBe(digest('abc'))
    expect(digest('abc')).not.toBe(digest('abd'))
  })

  it('logs a rejection with its reason', () => {
    const log = new AuditLog()
    log.append({
      type: 'REJECT', fieldId: 'id_images', at: AT,
      reason: 'The photo was too dark',
    })
    expect(log.entries()[0]?.kind).toBe('rejected')
    expect(log.entries()[0]?.reason).toMatch(/too dark/)
  })

  it('starts empty for a fresh application', () => {
    createApplication('app-1', profile)
    expect(new AuditLog().size()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/audit/log.test.ts`
Expected: FAIL — cannot resolve `@/domain/audit/log`.

- [ ] **Step 3: Write the event types**

`src/domain/audit/event.ts`:

```ts
import type { FieldId } from '../field-id'
import type { ProvenanceSource } from '../application/state'

export type AuditKind =
  | 'value_set' | 'confirmed' | 'verified'
  | 'rejected' | 'superseded' | 'profile_updated'

export type AuditEvent = {
  seq: number
  at: string
  kind: AuditKind
  fieldId?: FieldId
  source?: ProvenanceSource
  /** Present only for non-sensitive fields. */
  value?: unknown
  /** Present instead of `value` for sensitive fields. */
  valueDigest?: string
  /** Hash of the copy the user was shown when they confirmed. Spec §10.1. */
  shownCopyHash?: string
  reason?: string
}
```

- [ ] **Step 4: Write the log**

`src/domain/audit/log.ts`:

```ts
import type { Action } from '../application/state'
import { CATALOG } from '../catalog'
import type { AuditEvent, AuditKind } from './event'

/**
 * Small, stable, non-cryptographic digest (FNV-1a). Enough to prove a value
 * did not change between events without storing the value itself. Swap for a
 * keyed hash if the audit log ever leaves our infrastructure.
 */
export function digest(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const KIND: Record<Action['type'], AuditKind> = {
  SET_VALUE: 'value_set',
  CONFIRM: 'confirmed',
  VERIFY: 'verified',
  REJECT: 'rejected',
  SUPERSEDE: 'superseded',
  UPDATE_PROFILE: 'profile_updated',
}

/** Append-only. There is deliberately no delete, no edit, no undo. */
export class AuditLog {
  #entries: AuditEvent[] = []

  append(action: Action): AuditEvent {
    const base: AuditEvent = {
      seq: this.#entries.length + 1,
      at: action.at,
      kind: KIND[action.type],
    }

    if ('fieldId' in action) base.fieldId = action.fieldId

    if (action.type === 'SET_VALUE') {
      base.source = action.source
      const def = CATALOG.get(action.fieldId)
      if (def?.sensitive) {
        base.valueDigest = digest(String(action.value))
      } else {
        base.value = action.value
      }
    }

    if (action.type === 'CONFIRM') base.shownCopyHash = action.shownCopyHash
    if (action.type === 'REJECT') base.reason = action.reason

    this.#entries.push(base)
    return base
  }

  entries(): readonly AuditEvent[] {
    return Object.freeze([...this.#entries])
  }

  size(): number {
    return this.#entries.length
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/domain/audit/log.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/domain/audit tests/domain/audit
git commit -m "feat: add append-only audit log with sensitive-value digests"
```

---

### Task 8: Theme tokens

**Files:**
- Create: `src/ui/theme/tokens.ts`
- Test: `tests/ui/theme/tokens.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `COLOR` (frozen record), `STATUS_COLOR: Record<FieldStatus, string>`

- [ ] **Step 1: Write the failing test**

`tests/ui/theme/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { COLOR, STATUS_COLOR } from '@/ui/theme/tokens'

describe('theme tokens', () => {
  it('uses the measured IAA primary red', () => {
    expect(COLOR.primary).toBe('#B82018')
  })

  it('never uses red for errors — red is the brand', () => {
    expect(COLOR.error).toBe('#E87830')
    expect(COLOR.error).not.toBe(COLOR.primary)
  })

  it('reuses the existing success green for verified fields', () => {
    expect(COLOR.success).toBe('#408030')
    expect(STATUS_COLOR.verified).toBe(COLOR.success)
    expect(STATUS_COLOR.confirmed).toBe(COLOR.success)
  })

  it('gives derived fields a neutral, not a new hue', () => {
    expect(STATUS_COLOR.derived).toBe(COLOR.textMuted)
  })

  it('colours rejected fields with the warning orange', () => {
    expect(STATUS_COLOR.rejected).toBe(COLOR.error)
  })

  it('exposes every colour as a six-digit hex', () => {
    for (const [k, v] of Object.entries(COLOR)) {
      expect(v, k).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/theme/tokens.test.ts`
Expected: FAIL — cannot resolve `@/ui/theme/tokens`.

- [ ] **Step 3: Write the implementation**

`src/ui/theme/tokens.ts`:

```ts
import type { FieldStatus } from '@/domain/application/state'

/**
 * Sampled from the existing IAA screens (spec §9). Note that RED IS THE
 * BRAND, so red must never signal an error — that is what `error` (orange)
 * is for. Component libraries default `destructive` to red; override it.
 */
export const COLOR = Object.freeze({
  primary: '#B82018',
  primaryDisabled: '#E0B0B0',
  success: '#408030',
  successSurface: '#E0E8D8',
  error: '#E87830',
  errorSurface: '#F8E8D8',
  textPrimary: '#202020',
  textSecondary: '#404040',
  textMuted: '#A8A8A8',
  border: '#C8C8C8',
  divider: '#E0E0E0',
  page: '#F8F8F8',
  surface: '#FFFFFF',
})

/**
 * `derived` deliberately gets a neutral rather than a fourth hue: red,
 * orange and green are all taken, and the "we read this but you have not
 * confirmed it" state is carried by texture (a dashed rule) instead. Spec §9.
 */
export const STATUS_COLOR: Record<FieldStatus, string> = {
  empty: COLOR.textMuted,
  derived: COLOR.textMuted,
  confirmed: COLOR.success,
  verified: COLOR.success,
  rejected: COLOR.error,
  superseded: COLOR.textMuted,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/theme/tokens.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/theme tests/ui/theme
git commit -m "feat: add measured IAA theme tokens"
```

---

### Task 9: Rationale and FieldRow components

**Files:**
- Create: `src/ui/panel/Rationale.tsx`, `src/ui/panel/FieldRow.tsx`
- Test: `tests/ui/panel/FieldRow.test.tsx`

**Interfaces:**
- Consumes: `fieldDef`, `AUTHORITY_LABEL`, `FieldState`, `COLOR`, `STATUS_COLOR`
- Produces: `<Rationale field={FieldDef} />`, `<FieldRow fieldId={FieldId} state={FieldState | undefined} onConfirm={(id) => void} onEdit={(id) => void} />`

- [ ] **Step 1: Write the failing test**

`tests/ui/panel/FieldRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldRow } from '@/ui/panel/FieldRow'
import type { FieldState } from '@/domain/application/state'

const derived: FieldState = {
  value: '1982-08-31',
  status: 'derived',
  provenance: { source: 'ocr', confidence: 0.96, documentId: 'doc-1' },
}

describe('FieldRow', () => {
  it('always shows why the field is needed', () => {
    render(<FieldRow fieldId="dob" state={undefined} />)
    expect(screen.getByText(/confirms you are old enough/i)).toBeInTheDocument()
  })

  it('names the authority that requires it', () => {
    render(<FieldRow fieldId="tax_id" state={undefined} />)
    expect(screen.getByText(/the IRS/i)).toBeInTheDocument()
  })

  it('shows handling copy for a sensitive field without any interaction', () => {
    render(<FieldRow fieldId="tax_id" state={undefined} />)
    expect(screen.getByText(/encrypted at rest/i)).toBeInTheDocument()
  })

  it('offers a confirm affordance for a derived value', async () => {
    const onConfirm = vi.fn()
    render(<FieldRow fieldId="dob" state={derived} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: /looks right/i }))
    expect(onConfirm).toHaveBeenCalledWith('dob')
  })

  it('attributes a derived value to its source', () => {
    render(<FieldRow fieldId="dob" state={derived} />)
    expect(screen.getByText(/from your document/i)).toBeInTheDocument()
  })

  it('does not offer confirm once the value is confirmed', () => {
    render(
      <FieldRow fieldId="dob" state={{ ...derived, status: 'confirmed' }} />,
    )
    expect(screen.queryByRole('button', { name: /looks right/i })).toBeNull()
  })

  it('shows a human-readable rejection reason', () => {
    render(
      <FieldRow
        fieldId="id_images"
        state={{
          value: ['img-1'],
          status: 'rejected',
          rejection: {
            reason: 'The photo was too dark to read your license number',
            at: '2026-08-01T12:00:00.000Z',
          },
        }}
      />,
    )
    expect(screen.getByText(/too dark to read/i)).toBeInTheDocument()
  })

  it('announces provenance to screen readers', () => {
    render(<FieldRow fieldId="dob" state={derived} />)
    const row = screen.getByRole('group', { name: /date of birth/i })
    expect(row).toHaveAttribute('aria-describedby')
  })
})
```

- [ ] **Step 2: Install the interaction testing library**

Run: `npm install -D @testing-library/user-event@^14.5.2`

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/ui/panel/FieldRow.test.tsx`
Expected: FAIL — cannot resolve `@/ui/panel/FieldRow`.

- [ ] **Step 4: Write Rationale**

`src/ui/panel/Rationale.tsx`:

```tsx
import { AUTHORITY_LABEL } from '@/domain/authority'
import type { FieldDef } from '@/domain/field-def'
import { COLOR } from '@/ui/theme/tokens'

/**
 * Every ask carries its reason. These strings come from the catalog and are
 * rendered verbatim — they are never generated or paraphrased. Spec §7.
 */
export function Rationale({ field, id }: { field: FieldDef; id?: string }) {
  return (
    <div id={id} style={{ fontSize: 13, color: COLOR.textSecondary }}>
      <p style={{ margin: '2px 0' }}>{field.purpose}</p>
      <p style={{ margin: '2px 0', color: COLOR.textMuted }}>
        Required by {AUTHORITY_LABEL[field.authority]}
        {field.destination ? ` · goes on ${field.destination}` : ''}
      </p>
      {field.consequence && (
        <p style={{ margin: '2px 0' }}>{field.consequence}</p>
      )}
      {/* Sensitive fields answer the privacy question up front, never on
          hover — that is where people abandon. Spec §9.1. */}
      {field.sensitive && field.handling && (
        <p style={{ margin: '2px 0', color: COLOR.textSecondary }}>
          {field.handling}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Write FieldRow**

`src/ui/panel/FieldRow.tsx`:

```tsx
import type { FieldState } from '@/domain/application/state'
import { fieldDef } from '@/domain/catalog'
import type { FieldId } from '@/domain/field-id'
import { COLOR, STATUS_COLOR } from '@/ui/theme/tokens'
import { Rationale } from './Rationale'

type Props = {
  fieldId: FieldId
  state: FieldState | undefined
  onConfirm?: (id: FieldId) => void
  onEdit?: (id: FieldId) => void
}

const SOURCE_LABEL: Record<string, string> = {
  ocr: 'from your document',
  carried: 'same as the address you already gave',
  lookup: 'looked up for you',
  user: 'entered by you',
}

export function FieldRow({ fieldId, state, onConfirm, onEdit }: Props) {
  const def = fieldDef(fieldId)
  const status = state?.status ?? 'empty'
  const isDerived = status === 'derived'
  const rationaleId = `rationale-${fieldId}`

  return (
    <div
      role="group"
      aria-label={def.label}
      aria-describedby={rationaleId}
      style={{
        padding: '12px 14px',
        marginBottom: 8,
        background: COLOR.surface,
        // Texture, not a new hue: dashed means "we read this, you have not
        // confirmed it". Spec §9.
        borderLeft: `3px ${isDerived ? 'dashed' : 'solid'} ${STATUS_COLOR[status]}`,
        borderTop: `1px solid ${COLOR.divider}`,
        borderRight: `1px solid ${COLOR.divider}`,
        borderBottom: `1px solid ${COLOR.divider}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: 12, letterSpacing: '.04em', color: COLOR.textPrimary }}>
          {def.label.toUpperCase()}
        </strong>
        {(status === 'confirmed' || status === 'verified') && (
          <span aria-label="confirmed" style={{ color: COLOR.success }}>✓</span>
        )}
      </div>

      {state?.value != null && (
        <div style={{ fontSize: 15, color: COLOR.textPrimary, margin: '4px 0' }}>
          {String(state.value)}
        </div>
      )}

      <Rationale field={def} id={rationaleId} />

      {state?.provenance && (
        <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '4px 0 0' }}>
          {SOURCE_LABEL[state.provenance.source] ?? state.provenance.source}
        </p>
      )}

      {state?.rejection && (
        <p
          style={{
            fontSize: 13, margin: '6px 0 0', padding: '6px 8px',
            background: COLOR.errorSurface, color: COLOR.textPrimary,
          }}
        >
          {state.rejection.reason}
        </p>
      )}

      {isDerived && onConfirm && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => onConfirm(fieldId)}
            style={{
              background: COLOR.primary, color: COLOR.surface,
              border: 'none', padding: '6px 12px', cursor: 'pointer',
            }}
          >
            Looks right
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(fieldId)}
              style={{
                background: COLOR.surface, color: COLOR.primary,
                border: `1px solid ${COLOR.primary}`, padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              Fix this
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/ui/panel/FieldRow.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 7: Commit**

```bash
git add src/ui/panel tests/ui/panel package.json package-lock.json
git commit -m "feat: add FieldRow and Rationale components"
```

---

### Task 10: ProgressSummary and ApplicationPanel

**Files:**
- Create: `src/ui/panel/ProgressSummary.tsx`, `src/ui/panel/ApplicationPanel.tsx`
- Test: `tests/ui/panel/ApplicationPanel.test.tsx`

**Interfaces:**
- Consumes: `FieldRow`, `outstandingFields`, `isComplete`, `requiredFields`, `ApplicationState`, `COLOR`
- Produces: `<ProgressSummary done={number} total={number} onSubmit={() => void} />`, `<ApplicationPanel state={ApplicationState} onConfirm onEdit onSubmit />`

- [ ] **Step 1: Write the failing test**

`tests/ui/panel/ApplicationPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import {
  applicationReducer, createApplication, outstandingFields,
} from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const AT = '2026-08-01T12:00:00.000Z'
const profile: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA',
  wantsGsa: false, licenseCount: 0,
}

describe('ApplicationPanel', () => {
  it('shows how many fields are left', () => {
    const s = createApplication('app-1', profile)
    render(<ApplicationPanel state={s} />)
    const total = outstandingFields(s).length
    expect(screen.getByText(new RegExp(`0 of ${total}`))).toBeInTheDocument()
  })

  it('renders a row for every required field', () => {
    const s = createApplication('app-1', profile)
    render(<ApplicationPanel state={s} />)
    expect(screen.getAllByRole('group').length).toBe(
      outstandingFields(s).length,
    )
  })

  it('never disables the submit button — it explains instead', () => {
    const s = createApplication('app-1', profile)
    render(<ApplicationPanel state={s} />)
    const btn = screen.getByRole('button', { name: /submit/i })
    expect(btn).not.toBeDisabled()
    expect(screen.getByText(/left to go/i)).toBeInTheDocument()
  })

  it('reports progress as fields are completed', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    render(<ApplicationPanel state={s} />)
    expect(screen.getByText(/^1 of /)).toBeInTheDocument()
  })

  it('passes a confirm through to the caller', async () => {
    const onConfirm = vi.fn()
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT,
    })
    render(<ApplicationPanel state={s} onConfirm={onConfirm} />)
    await userEvent.click(
      screen.getAllByRole('button', { name: /looks right/i })[0]!,
    )
    expect(onConfirm).toHaveBeenCalledWith('first_name')
  })

  it('calls onSubmit when everything is done', async () => {
    const onSubmit = vi.fn()
    let s = createApplication('app-1', profile)
    for (const id of outstandingFields(s)) {
      s = applicationReducer(s, {
        type: 'SET_VALUE', fieldId: id, value: 'x', source: 'user', at: AT,
      })
    }
    render(<ApplicationPanel state={s} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(onSubmit).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/panel/ApplicationPanel.test.tsx`
Expected: FAIL — cannot resolve `@/ui/panel/ApplicationPanel`.

- [ ] **Step 3: Write ProgressSummary**

`src/ui/panel/ProgressSummary.tsx`:

```tsx
import { COLOR } from '@/ui/theme/tokens'

type Props = {
  done: number
  total: number
  onSubmit?: () => void
}

/**
 * The primary button is NEVER disabled (spec §9). A greyed-out button reads
 * as broken; naming what is outstanding reads as a next step.
 */
export function ProgressSummary({ done, total, onSubmit }: Props) {
  const remaining = total - done
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '12px 14px', borderTop: `1px solid ${COLOR.divider}`,
      }}
    >
      <div>
        <div style={{ fontSize: 14, color: COLOR.textPrimary }}>
          {done} of {total} done
        </div>
        {remaining > 0 && (
          <div style={{ fontSize: 13, color: COLOR.textSecondary }}>
            {remaining} left to go
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        style={{
          background: COLOR.primary, color: COLOR.surface, border: 'none',
          padding: '10px 18px', fontSize: 15, cursor: 'pointer',
        }}
      >
        Submit for review
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Write ApplicationPanel**

`src/ui/panel/ApplicationPanel.tsx`:

```tsx
import { outstandingFields } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { FieldId } from '@/domain/field-id'
import { requiredFields } from '@/domain/requirements/engine'
import { COLOR } from '@/ui/theme/tokens'
import { FieldRow } from './FieldRow'
import { ProgressSummary } from './ProgressSummary'

type Props = {
  state: ApplicationState
  onConfirm?: (id: FieldId) => void
  onEdit?: (id: FieldId) => void
  onSubmit?: () => void
}

/**
 * The panel alone can complete an application. That is a resilience
 * requirement, not a rival to the agent — if the model is down, registration
 * must not be. Spec §11.1.
 */
export function ApplicationPanel({ state, onConfirm, onEdit, onSubmit }: Props) {
  const required = requiredFields(state.profile)
  const outstanding = outstandingFields(state)
  const done = required.length - outstanding.length

  return (
    <section
      aria-label="Your application"
      style={{ background: COLOR.page, maxWidth: 560 }}
    >
      <h2
        style={{
          fontSize: 16, margin: 0, padding: '14px',
          color: COLOR.textPrimary, borderBottom: `1px solid ${COLOR.divider}`,
        }}
      >
        Your application
      </h2>

      <div style={{ padding: 14 }}>
        {required.map((id) => (
          <FieldRow
            key={id}
            fieldId={id}
            state={state.fields[id]}
            {...(onConfirm && { onConfirm })}
            {...(onEdit && { onEdit })}
          />
        ))}
      </div>

      <ProgressSummary
        done={done}
        total={required.length}
        {...(onSubmit && { onSubmit })}
      />
    </section>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ui/panel/ApplicationPanel.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/ui/panel tests/ui/panel
git commit -m "feat: add ApplicationPanel and never-disabled ProgressSummary"
```

---

### Task 11: Wire the panel into Next.js and prove an end-to-end registration

**Files:**
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/api/application/route.ts`, `src/server/store.ts`
- Test: `tests/integration/complete-registration.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: `getApplication(id)`, `putApplication(state)`, `resetStore()` from `@/server/store`; `GET`/`POST` handlers

- [ ] **Step 1: Write the failing integration test**

`tests/integration/complete-registration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
import { applyCarry } from '@/domain/application/carry'
import { AuditLog } from '@/domain/audit/log'
import { getApplication, putApplication, resetStore } from '@/server/store'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Action } from '@/domain/application/state'

const AT = '2026-08-01T12:00:00.000Z'
const business: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'GA',
  wantsGsa: false, licenseCount: 1,
}

beforeEach(() => resetStore())

describe('a whole registration, panel only', () => {
  it('completes with no LLM and no OCR', () => {
    let s = createApplication('app-1', business)
    const log = new AuditLog()

    for (const id of outstandingFields(s)) {
      const action: Action = {
        type: 'SET_VALUE', fieldId: id, value: 'x', source: 'user', at: AT,
      }
      s = applicationReducer(s, action)
      log.append(action)
    }

    expect(isComplete(s)).toBe(true)
    expect(log.size()).toBeGreaterThan(0)
  })

  it('never writes a raw taxpayer ID into the audit log', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'tax_id', value: '12-3456789',
      source: 'user', at: AT,
    })
    expect(JSON.stringify(log.entries())).not.toContain('12-3456789')
  })

  it('saves the applicant from typing their address twice', () => {
    let s = createApplication('app-1', business)
    for (const [id, v] of [
      ['addr_line1', '2345 Anywhere St'],
      ['addr_city', 'Atlanta'],
      ['addr_state', 'GA'],
      ['addr_zip', '30301'],
    ] as const) {
      s = applicationReducer(s, {
        type: 'SET_VALUE', fieldId: id, value: v, source: 'user', at: AT,
      })
    }
    const before = outstandingFields(s).length
    s = applyCarry(s, AT)
    // carried fields hold values, so only confirmation remains
    expect(s.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
    expect(before).toBeGreaterThan(0)
  })

  it('round-trips through the store', () => {
    const s = createApplication('app-1', business)
    putApplication(s)
    expect(getApplication('app-1')?.id).toBe('app-1')
    expect(getApplication('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/complete-registration.test.ts`
Expected: FAIL — cannot resolve `@/server/store`.

- [ ] **Step 3: Write the store**

`src/server/store.ts`:

```ts
import type { ApplicationState } from '@/domain/application/state'

/**
 * In-memory for phase 1. Swapped for a real database in phase 4, when the
 * review queue needs to read applications from another process.
 */
const applications = new Map<string, ApplicationState>()

export function getApplication(id: string): ApplicationState | undefined {
  return applications.get(id)
}

export function putApplication(state: ApplicationState): void {
  applications.set(state.id, state)
}

export function resetStore(): void {
  applications.clear()
}
```

- [ ] **Step 4: Write the route handler**

`src/app/api/application/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { getApplication, putApplication } from '@/server/store'
import type { Action } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = getApplication(id)
  if (existing) return NextResponse.json(existing)

  const profile: ApplicantProfile = {
    applicantType: 'individual',
    country: 'US',
    state: null,
    wantsGsa: false,
    licenseCount: 0,
  }
  const created = createApplication(id, profile)
  putApplication(created)
  return NextResponse.json(created)
}

export async function POST(request: Request) {
  const body = (await request.json()) as { id: string; action: Action }
  const current = getApplication(body.id)
  if (!current) {
    return NextResponse.json({ error: 'unknown application' }, { status: 404 })
  }

  const next = applicationReducer(current, body.action)
  putApplication(next)
  return NextResponse.json(next)
}
```

- [ ] **Step 5: Write the page**

`src/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react'

export const metadata = { title: 'IAA Buyer Registration' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
```

`src/app/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { FieldId } from '@/domain/field-id'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const profile: ApplicantProfile = {
  applicantType: 'business',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenseCount: 1,
}

export default function Page() {
  const [state, setState] = useState(() => createApplication('demo', profile))

  const confirm = (id: FieldId) =>
    setState((s) =>
      applicationReducer(s, {
        type: 'CONFIRM',
        fieldId: id,
        at: new Date().toISOString(),
        shownCopyHash: 'catalog-v1',
      }),
    )

  return (
    <main style={{ padding: 24 }}>
      <ApplicationPanel state={state} onConfirm={confirm} />
    </main>
  )
}
```

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — every test from Tasks 1–11.

- [ ] **Step 7: Verify types and build**

Run: `npm run typecheck && npm run build`
Expected: no type errors, successful Next.js build.

- [ ] **Step 8: Commit**

```bash
git add src/app src/server tests/integration
git commit -m "feat: wire panel into Next.js with an end-to-end registration test"
```

---

## Definition of done for Phase 1

- [ ] `npx vitest run` passes with no skipped tests
- [ ] `npm run typecheck` reports no errors
- [ ] `npm run build` succeeds
- [ ] A field cannot be added without `purpose` and `authority` (Task 1 test proves it)
- [ ] The audit log contains no raw sensitive values (Task 11 test proves it)
- [ ] A registration can be completed through the panel with no LLM and no OCR
- [ ] No file in `src/domain/` imports `ai`, `next`, or performs any I/O

## What Phase 1 deliberately does not do

Deferred to later phases, per spec §15 — do not build these now:

- OCR, provenance crops, confidence-driven display (Phase 2)
- The agent, copy tiers, PII redaction boundary, conversational shell (Phase 3)
- Human review queue, status timeline, notifications (Phase 4)
- DocuSign prefill and the separate attestation step (Phase 5)
- Rule versioning migration on resume (spec §8.5) — `RULES_VERSION` is recorded
  on every application in Task 5 so the data is ready, but the re-evaluation
  path is built in Phase 4 alongside the review queue that needs it
