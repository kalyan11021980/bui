# Profile Capture and Missing IAA Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the six profile determinants askable catalog fields (bridged to `ApplicantProfile`), and add the IAA inputs we never modeled: primary phone, address country, W-9 line 3 + certification, POA and bid-card uploads.

**Architecture:** Determinants become fields in the `profile` section; a reducer-level bridge keeps field state and `ApplicantProfile` consistent in both directions, and carries declared licence types into each licence group. Requirement lists that depend on profile answers become functions (`profileFields`, `addressFields`, `businessFields`). Two new field types (`multiselect`, `attest`) extend the existing render map.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Zod v3 (`import { z } from 'zod'` — `zod/v4` is ONLY for `library.ts`), Next.js, React, vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-profile-capture-and-missing-inputs-design.md`

## Global Constraints

- Run tests with `npx vitest run <path>`; full suite `npx vitest run`. Typecheck with `npx tsc --noEmit`. **Paste the actual `tsc` output in your task report** — a typecheck failure leaves no trace in a diff.
- **Every new test must be seen failing first.** Run it before implementing and record the failure. After it passes, re-check: could this test still pass if the feature were deleted? If yes, the test is broken — fix it before committing.
- Comments: short and sparse; only state constraints the code cannot show. No essays, no section references, no "this is correct because" notes.
- Copy rule: any edit to `src/domain/orchestrator/copy.ts` strings bumps `COPY_VERSION`. Model output never lands in copy; new user-facing strings are vetted copy or catalog `purpose`/`label` text.
- No hardcoded hosts, ports, or model ids — config comes from env vars.
- Do not run vitest from a checkout containing `.claude/worktrees/*` copies (phantom failures); run from the worktree root itself.
- `defineField` throws on empty `label`/`purpose` and on `sensitive` + `orchestratorVisible` together.
- Existing conventions: two-space indent, single quotes, no semicolons where the file omits them — match the file you are editing.

---

### Task 1: `bizCountry` on the profile

**Files:**
- Modify: `src/domain/requirements/rules.ts` (ApplicantProfile, ALL_PROFILE_KEYS; add `isUnitedStates`)
- Modify: `src/domain/application/action-schema.ts` (profilePatch, toAction)
- Modify: `src/server/application-service.ts` (STARTING_PROFILE)
- Test: `tests/domain/requirements/rules.test.ts`, `tests/domain/application/action-schema.test.ts`

**Interfaces:**
- Produces: `ApplicantProfile.bizCountry: string | null`; `isUnitedStates(country: string | null): boolean` exported from `rules.ts` (null, `'US'` and `'USA'` are all US — the catalog stores ISO-3 `'USA'`, the agent volunteers `'US'`, and `bizCountry: null` means "not asked yet, assume US").

- [ ] **Step 1: Write the failing tests**

In `tests/domain/requirements/rules.test.ts` add:

```ts
import { ALL_PROFILE_KEYS, isUnitedStates } from '@/domain/requirements/rules'

describe('bizCountry', () => {
  it('is a listed profile key', () => {
    expect(ALL_PROFILE_KEYS).toContain('bizCountry')
  })
})

describe('isUnitedStates', () => {
  it('accepts null, US and USA; rejects others', () => {
    expect(isUnitedStates(null)).toBe(true)
    expect(isUnitedStates('US')).toBe(true)
    expect(isUnitedStates('USA')).toBe(true)
    expect(isUnitedStates('CAN')).toBe(false)
  })
})
```

In `tests/domain/application/action-schema.test.ts` add:

```ts
it('accepts bizCountry in a profile patch and threads it through toAction', () => {
  const parsed = actionSchema.parse({
    type: 'UPDATE_PROFILE', at: '2026-08-07T00:00:00Z', patch: { bizCountry: 'CAN' },
  })
  const action = toAction(parsed)
  expect(action).toEqual({
    type: 'UPDATE_PROFILE', at: '2026-08-07T00:00:00Z', patch: { bizCountry: 'CAN' },
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/domain/requirements/rules.test.ts tests/domain/application/action-schema.test.ts`
Expected: FAIL — `isUnitedStates` not exported; `bizCountry` missing; strict patch rejects the key.

- [ ] **Step 3: Implement**

`rules.ts` — extend the type (with the doc comment), the runtime array, and add the helper:

```ts
export type ApplicantProfile = {
  // …existing keys unchanged…
  /** Where the business is registered. Null before asked; null reads as US. */
  bizCountry: string | null
}

export const ALL_PROFILE_KEYS = [
  'applicantType', 'country', 'state', 'wantsGsa', 'licenses',
  'addressDiffersFromId', 'idForm', 'bizCountry',
] as const satisfies readonly (keyof ApplicantProfile)[]

/** The catalog stores ISO-3 'USA'; an agent volunteering 'US' must not read as foreign. */
export function isUnitedStates(country: string | null): boolean {
  return country === null || country === 'USA' || country === 'US'
}
```

`action-schema.ts` — in `profilePatch` add `bizCountry: z.string().min(1).nullable().optional(),`; in `toAction`'s `UPDATE_PROFILE` case add `...(p.bizCountry !== undefined && { bizCountry: p.bizCountry }),`.

`application-service.ts` — add `bizCountry: null,` to `STARTING_PROFILE`.

- [ ] **Step 4: Fix every ApplicantProfile literal tsc now rejects**

Run: `npx tsc --noEmit`. Each error is a fixture missing the key — add `bizCountry: null,` to each (test fixtures included). Then `npx vitest run` — the existing ALL_PROFILE_KEYS-vs-profilePatch coverage test must be green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(profile): bizCountry key and isUnitedStates helper"
```

---

### Task 2: Field types, ids, and the country schema

**Files:**
- Modify: `src/domain/field-def.ts` (FieldType union, `attestation` prop)
- Modify: `src/domain/field-id.ts` (17 new ids; fix the header comment)
- Modify: `src/domain/catalog/geography.ts` (export `countrySchema`)
- Test: `tests/domain/field-def.test.ts`

**Interfaces:**
- Produces: `FieldType` gains `'multiselect' | 'attest'`; `FieldDefBase.attestation?: VettedCopyId`; `countrySchema` (Zod enum over `ID_COUNTRIES` values) exported from geography.
- Note: the new ids will make `tests/domain/catalog/coverage.test.ts` (every id has a catalog entry) fail until Task 3 lands. That is expected RED across a task boundary — Tasks 2 and 3 may be committed together if the implementer prefers a green tree per commit; otherwise commit Task 2 with the coverage test temporarily failing and say so in the report.

- [ ] **Step 1: Write the failing test**

In `tests/domain/field-def.test.ts` add:

```ts
it('accepts multiselect and attest field types', () => {
  const def = defineField({
    id: 'licenses_held',
    label: 'Which business licenses do you hold?',
    type: 'multiselect',
    section: 'profile',
    purpose: 'test',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string()).min(1),
  })
  expect(def.type).toBe('multiselect')
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/domain/field-def.test.ts`
Expected: FAIL — `'licenses_held'` is not a `FieldId` and `'multiselect'` is not a `FieldType` (tsc errors surface as vitest transform failures).

- [ ] **Step 3: Implement**

`field-def.ts`:

```ts
import type { VettedCopyId } from './orchestrator/copy'

export type FieldType =
  | 'text' | 'date' | 'select' | 'phone' | 'address' | 'file' | 'taxid'
  | 'multiselect' | 'attest'
```

and in `FieldDefBase`, after `destination`:

```ts
  /** For `attest` fields: the vetted copy shown above the signature input. */
  attestation?: VettedCopyId
```

`field-id.ts` — replace the header comment's second paragraph (it says applicant type/country/state/ID form are NOT here; they now are, bridged) and add the ids:

```ts
/**
 * A runtime array rather than a bare type union, so a test can check that every
 * declared id has a catalog entry. It did not, for five ids, for all of phase 1.
 *
 * The profile determinants ARE here: each is a catalog field bridged to its
 * `ApplicantProfile` key (see profile-bridge.ts), so one answer feeds both.
 */
export const ALL_FIELD_IDS = [
  // profile determinants
  'applicant_type', 'location_country', 'location_state', 'id_form',
  'address_differs', 'licenses_held', 'wants_gsa',
  // preferences
  'primary_activity', 'preferred_language',
  // identity — unchanged
  'first_name', 'last_name', 'dl_number', 'id_number', 'passport_number',
  'dl_expiry', 'id_country', 'id_state', 'dob', 'id_images', 'proof_of_residency',
  // personal address
  'addr_line1', 'addr_city', 'addr_state', 'addr_zip', 'addr_region', 'addr_postal',
  // contact
  'phone_primary', 'phone_mobile',
  // business
  'biz_name', 'biz_legal_name', 'biz_country',
  'biz_addr_line1', 'biz_addr_city',
  'biz_addr_state', 'biz_addr_zip', 'biz_addr_region', 'biz_addr_postal', 'biz_phone',
  // license — unchanged
  'license_type', 'license_number', 'license_effective',
  'license_expiry', 'license_country', 'license_image',
  // tax
  'tax_classification', 'tax_id', 'tax_certification',
  // gsa
  'gsa_bidder_number', 'gsa_email',
  // state-specific forms
  'oh_foreign_buyer_form', 'poa_form', 'bid_card',
] as const
```

`geography.ts` — alongside the existing two schema exports:

```ts
export const countrySchema = enumOf(ID_COUNTRIES, 'Select your country')
```

- [ ] **Step 4: Run test, verify it passes; run tsc**

Run: `npx vitest run tests/domain/field-def.test.ts` → PASS. `npx tsc --noEmit` → clean. `npx vitest run tests/domain/catalog/coverage.test.ts` → expected FAIL (ids without defs) until Task 3.

- [ ] **Step 5: Commit** (or hold and commit with Task 3)

```bash
git add -A && git commit -m "feat(catalog): multiselect and attest types, new field ids, countrySchema"
```

---

### Task 3: Catalog definitions and W-9 copy

**Files:**
- Create: `src/domain/catalog/profile.ts`
- Modify: `src/domain/catalog/address.ts`, `business.ts`, `contact.ts`, `tax.ts`, `state-forms.ts`, `index.ts`
- Modify: `src/domain/orchestrator/copy.ts` (`w9_certification`, COPY_VERSION `'6'` → `'7'`)
- Test: `tests/domain/catalog/coverage.test.ts` (existing — goes green), `tests/domain/catalog/index.test.ts`

**Interfaces:**
- Consumes: `countrySchema`, `FieldType` extensions from Task 2.
- Produces: `PROFILE_FIELDS` export; defs for every id added in Task 2. Stored values: `applicant_type` ∈ `business|individual`; `id_form` ∈ `drivers_license|state_id|passport`; `address_differs`/`wants_gsa` ∈ `'yes'|'no'`; `licenses_held` = non-empty array of `dealer|dismantler|exporter|salvage`; countries = ISO-3 codes from `ID_COUNTRIES`.

- [ ] **Step 1: Failing test is already in place**

`npx vitest run tests/domain/catalog/coverage.test.ts` → FAIL (Task 2's ids have no defs). Also add to `tests/domain/catalog/index.test.ts`:

```ts
it('resolves the new determinant and tax fields with their wire values', () => {
  expect(fieldDef('applicant_type').options?.map((o) => o.value))
    .toEqual(['business', 'individual'])
  expect(fieldDef('licenses_held').type).toBe('multiselect')
  expect(fieldDef('tax_certification').attestation).toBe('w9_certification')
  expect(fieldDef('wants_gsa').validation.safeParse('yes').success).toBe(true)
  expect(fieldDef('licenses_held').validation.safeParse([]).success).toBe(false)
})
```

- [ ] **Step 2: Implement `src/domain/catalog/profile.ts`**

```ts
import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'
import { ID_COUNTRIES, US_STATES, countrySchema, usStateSchema } from './geography'

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

/**
 * The determinants: each is bridged to an ApplicantProfile key, so answering
 * one reshapes what the rest of the application asks.
 */
export const PROFILE_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'applicant_type',
    label: 'What best describes you?',
    type: 'select',
    options: [
      { value: 'business', label: 'Business with business license(s)' },
      { value: 'individual', label: 'Individual without business license(s)' },
    ],
    section: 'profile',
    purpose: 'Decides which questions the rest of the application asks',
    authority: 'IAA_POLICY',
    validation: z.enum(['business', 'individual']),
    orchestratorVisible: true,
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'location_country',
    label: 'Where are you located?',
    type: 'select',
    options: ID_COUNTRIES,
    section: 'profile',
    purpose: 'Registration requirements differ by country',
    authority: 'IAA_POLICY',
    validation: countrySchema,
    orchestratorVisible: true,
  }),
  defineField({
    id: 'location_state',
    label: 'Your state',
    type: 'select',
    options: US_STATES,
    section: 'profile',
    purpose: 'Some states require extra forms before you can bid',
    authority: 'STATE_DEALER_BOARD',
    validation: usStateSchema,
    orchestratorVisible: true,
  }),
  defineField({
    id: 'id_form',
    label: 'Which ID will you use?',
    type: 'select',
    options: [
      { value: 'drivers_license', label: "Driver's license" },
      { value: 'state_id', label: 'State ID' },
      { value: 'passport', label: 'Passport' },
    ],
    section: 'profile',
    purpose: 'Decides which document we read and which number we ask for',
    authority: 'FEDERAL_KYC',
    validation: z.enum(['drivers_license', 'state_id', 'passport']),
    orchestratorVisible: true,
  }),
  defineField({
    id: 'address_differs',
    label: 'Is your address different from the one on your ID?',
    type: 'select',
    options: YES_NO,
    section: 'profile',
    purpose: 'An address that does not match your ID needs separate proof',
    authority: 'FEDERAL_KYC',
    consequence: 'A utility bill, lease or mortgage statement covers the difference.',
    validation: z.enum(['yes', 'no']),
    orchestratorVisible: true,
  }),
  defineField({
    id: 'licenses_held',
    label: 'Which business licenses do you hold?',
    type: 'multiselect',
    options: [
      { value: 'dealer', label: 'Dealer' },
      { value: 'dismantler', label: 'Dismantler' },
      { value: 'exporter', label: 'Exporter' },
      { value: 'salvage', label: 'Salvage' },
    ],
    section: 'profile',
    purpose: 'Each license unlocks different vehicle categories',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'A business registration needs at least one. If you hold none, register as an individual.',
    validation: z
      .array(z.enum(['dealer', 'dismantler', 'exporter', 'salvage']))
      .min(1, 'Select at least one license'),
    orchestratorVisible: true,
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'wants_gsa',
    label: 'Do you want to bid on GSA government vehicles?',
    type: 'select',
    options: YES_NO,
    section: 'profile',
    purpose: 'Linking a GSA Fleet account unlocks government lots',
    authority: 'GSA',
    consequence: 'Skip this and you simply will not see GSA lots.',
    validation: z.enum(['yes', 'no']),
    orchestratorVisible: true,
  }),
]
```

- [ ] **Step 3: Extend the other catalog files**

`address.ts` — append to `ADDRESS_FIELDS` (and drop the header comment's implication that the four US parts are the whole section):

```ts
  defineField({
    id: 'addr_region',
    label: 'State / province / region',
    type: 'text',
    section: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your region'),
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'addr_postal',
    label: 'Postal code',
    type: 'text',
    section: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your postal code'),
    neverBulkConfirm: true,
  }),
```

`business.ts` — append:

```ts
  defineField({
    id: 'biz_country',
    label: 'Country where the business is registered',
    type: 'select',
    options: ID_COUNTRIES,
    section: 'business',
    purpose: 'Which country’s authority we verify your business against',
    authority: 'STATE_DEALER_BOARD',
    validation: countrySchema,
    orchestratorVisible: true,
  }),
  defineField({
    id: 'biz_addr_region',
    label: 'Business state / province / region',
    type: 'text',
    section: 'business',
    purpose: 'Where your dealer license is registered',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(1, 'Enter the region'),
  }),
  defineField({
    id: 'biz_addr_postal',
    label: 'Business postal code',
    type: 'text',
    section: 'business',
    purpose: 'Where your dealer license is registered',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(1, 'Enter the postal code'),
  }),
```

with `import { ID_COUNTRIES, countrySchema } from './geography'` merged into the existing geography import.

`contact.ts` — add before `phone_mobile`:

```ts
  defineField({
    id: 'phone_primary',
    label: 'Primary phone',
    type: 'phone',
    section: 'contact',
    purpose: 'The number Buyer Services calls about your account',
    authority: 'IAA_POLICY',
    validation: phoneSchema,
  }),
```

`tax.ts` — append:

```ts
  defineField({
    id: 'tax_classification',
    label: 'Federal tax classification',
    type: 'select',
    options: [
      { value: 'individual_sole_proprietor', label: 'Individual / sole proprietor or single-member LLC' },
      { value: 'c_corporation', label: 'C corporation' },
      { value: 's_corporation', label: 'S corporation' },
      { value: 'partnership', label: 'Partnership' },
      { value: 'trust_estate', label: 'Trust / estate' },
      { value: 'llc', label: 'Limited liability company' },
      { value: 'other', label: 'Other' },
    ],
    section: 'tax',
    purpose: 'The IRS asks how your business is classified for tax purposes',
    authority: 'IRS',
    destination: 'W-9, line 3',
    validation: z.enum([
      'individual_sole_proprietor', 'c_corporation', 's_corporation',
      'partnership', 'trust_estate', 'llc', 'other',
    ]),
  }),
  defineField({
    id: 'tax_certification',
    label: 'W-9 certification',
    type: 'attest',
    attestation: 'w9_certification',
    section: 'tax',
    purpose: 'The IRS requires you to certify the taxpayer information you gave us',
    authority: 'IRS',
    destination: 'W-9, Part II',
    handling: 'Stored with your application and never shown to other bidders.',
    validation: z.string().min(1, 'Type your full name to certify'),
    neverBulkConfirm: true,
  }),
```

`state-forms.ts` — append (the file's own header already says entries do nothing until STATE_RULES references them):

```ts
  defineField({
    id: 'poa_form',
    label: 'Power of attorney form',
    type: 'file',
    section: 'state_forms',
    purpose: 'Lets IAA sign sale documents on your behalf where a state requires it',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string().min(1)).min(1, 'Upload the completed form'),
  }),
  defineField({
    id: 'bid_card',
    label: 'State bid card',
    type: 'file',
    section: 'state_forms',
    purpose: 'Some states require a bid card before you can bid on their lots',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string().min(1)).min(1, 'Upload your bid card'),
  }),
```

`index.ts` — import and spread `PROFILE_FIELDS` first in `ALL_FIELDS`; re-export it alongside the others.

`copy.ts` — bump `COPY_VERSION` to `'7'`, add `'w9_certification'` to `ALL_COPY_IDS`, and add the entry (Form W-9 Rev. November 2017, Part II — IRS-prescribed wording, verbatim; do not paraphrase):

```ts
  w9_certification: [
    'Under penalties of perjury, I certify that:',
    '1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and',
    '2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and',
    '3. I am a U.S. citizen or other U.S. person (defined below); and',
    '4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.',
  ].join('\n'),
```

- [ ] **Step 4: Run tests, verify green; tsc**

Run: `npx vitest run tests/domain/catalog` → PASS including coverage. `npx tsc --noEmit` → paste output.
Note: `tests/domain/requirements/live-form-parity.test.ts` and copy-hash tests may now fail — if a failure is an assertion about the OLD field set or COPY_VERSION `'6'`, update the expectation; if it is anything else, stop and report.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(catalog): profile determinants, intl address, W-9 line 3 + certification, POA/bid-card"
```

---

### Task 4: Engine — requirement lists become profile functions

**Files:**
- Modify: `src/domain/requirements/rules.ts` (replace `CORE_PROFILE`, `CORE_ADDRESS`, `BUSINESS_CORE` with functions; `CORE_CONTACT` gains `phone_primary`; add `TAX_CORE`)
- Modify: `src/domain/requirements/engine.ts`
- Test: `tests/domain/requirements/engine.test.ts`, `tests/domain/requirements/rules.test.ts`

**Interfaces:**
- Consumes: `isUnitedStates` (Task 1), field ids (Task 2).
- Produces: `profileFields(profile)`, `addressFields(profile)`, `businessFields(profile)` — all `(profile: ApplicantProfile) => readonly FieldId[]`; `CORE_CONTACT = ['phone_primary', 'phone_mobile']`; `TAX_CORE = ['tax_classification', 'tax_id', 'tax_certification']`. `CORE_PROFILE`/`CORE_ADDRESS`/`BUSINESS_CORE` are deleted — later tasks and tests must use the functions.

- [ ] **Step 1: Write the failing tests**

In `tests/domain/requirements/engine.test.ts` (reuse the existing `base` fixture, which now carries `bizCountry: null`):

```ts
describe('profile determinants and expansions', () => {
  it('asks everyone the determinants first', () => {
    const k = requiredFields(base)
    for (const id of ['applicant_type', 'location_country', 'location_state',
      'id_form', 'address_differs', 'wants_gsa']) {
      expect(k).toContain(id)
    }
    expect(k).not.toContain('licenses_held')
  })

  it('asks a business which licences it holds, and the full tax trio', () => {
    const k = requiredFields({ ...base, applicantType: 'business' })
    expect(k).toContain('licenses_held')
    expect(k).toContain('tax_classification')
    expect(k).toContain('tax_certification')
  })

  it('swaps US state/zip for region/postal outside the US', () => {
    const k = requiredFields({ ...base, country: 'CAN' })
    expect(k).not.toContain('location_state')
    expect(k).toContain('addr_region')
    expect(k).toContain('addr_postal')
    expect(k).not.toContain('addr_state')
    expect(k).not.toContain('addr_zip')
  })

  it('swaps the business address block on bizCountry', () => {
    const k = requiredFields({ ...base, applicantType: 'business', bizCountry: 'MEX' })
    expect(k).toContain('biz_country')
    expect(k).toContain('biz_addr_region')
    expect(k).not.toContain('biz_addr_state')
  })

  it('requires both phones of everyone', () => {
    const k = requiredFields(base)
    expect(k).toContain('phone_primary')
    expect(k).toContain('phone_mobile')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/domain/requirements/engine.test.ts`
Expected: FAIL — determinant ids absent from `requiredFields`.

- [ ] **Step 3: Implement**

`rules.ts` — delete `CORE_PROFILE`, `CORE_ADDRESS`, `BUSINESS_CORE`; add (keeping `identityFields` and its comment as they are):

```ts
/** Determinants first: each answer reshapes what follows. */
export function profileFields(profile: ApplicantProfile): readonly FieldId[] {
  return [
    'applicant_type', 'location_country',
    ...(isUnitedStates(profile.country) ? ['location_state' as const] : []),
    'id_form', 'address_differs',
    ...(profile.applicantType === 'business' ? ['licenses_held' as const] : []),
    'wants_gsa',
    'primary_activity', 'preferred_language',
  ]
}

export function addressFields(profile: ApplicantProfile): readonly FieldId[] {
  return [
    'addr_line1', 'addr_city',
    ...(isUnitedStates(profile.country)
      ? ['addr_state' as const, 'addr_zip' as const]
      : ['addr_region' as const, 'addr_postal' as const]),
  ]
}

export function businessFields(profile: ApplicantProfile): readonly FieldId[] {
  return [
    'biz_name', 'biz_legal_name', 'biz_country',
    'biz_addr_line1', 'biz_addr_city',
    ...(isUnitedStates(profile.bizCountry)
      ? ['biz_addr_state' as const, 'biz_addr_zip' as const]
      : ['biz_addr_region' as const, 'biz_addr_postal' as const]),
    'biz_phone',
  ]
}

export const CORE_CONTACT: readonly FieldId[] = ['phone_primary', 'phone_mobile']

export const TAX_CORE: readonly FieldId[] = [
  'tax_classification', 'tax_id', 'tax_certification',
]
```

Also add one line to the `STATE_RULES` doc comment: `poa_form` and `bid_card` are defined and await a signed-off entry that references them (spec §7).

`engine.ts`:

```ts
export function requiredFields(profile: ApplicantProfile): RequirementKey[] {
  const out: RequirementKey[] = [
    ...profileFields(profile), ...identityFields(profile),
    ...addressFields(profile), ...CORE_CONTACT,
  ].map((id) => reqKey(id))

  if (profile.applicantType === 'business') {
    for (const id of businessFields(profile)) out.push(reqKey(id))
    for (const id of TAX_CORE) out.push(reqKey(id))

    profile.licenses.forEach((_licence, index) => {
      for (const id of LICENSE_GROUP) out.push(reqKey(id, index))
    })
  }

  if (profile.wantsGsa) for (const id of GSA_CORE) out.push(reqKey(id))

  const rule = profile.state
    ? STATE_RULES[profile.state.toUpperCase()]
    : undefined
  if (rule) for (const id of rule.additional) out.push(reqKey(id))

  return [...new Set(out)]
}
```

Update imports accordingly. Fix compile errors in anything else importing the deleted constants (`npx tsc --noEmit` finds them; substitute the function call with the relevant profile).

- [ ] **Step 4: Run tests, verify green; tsc**

Run: `npx vitest run tests/domain/requirements` then `npx tsc --noEmit` — paste both outputs. Update `live-form-parity.test.ts` expectations if they enumerate the old sets.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(engine): profile-driven field lists; both phones; tax trio"
```

---

### Task 5: The profile bridge table

**Files:**
- Create: `src/domain/application/profile-bridge.ts`
- Test: `tests/domain/application/profile-bridge.test.ts`

**Interfaces:**
- Produces:

```ts
export type BridgeEntry = {
  fieldId: FieldId
  key: keyof ApplicantProfile
  toPatch(value: unknown): Partial<ApplicantProfile>
  toFieldValue(value: ApplicantProfile[keyof ApplicantProfile]): unknown
}
export const PROFILE_BRIDGE: readonly BridgeEntry[]
export function bridgeForField(fieldId: FieldId): BridgeEntry | undefined
```

`toFieldValue` returning `null` means "nothing to record" (null state, empty licence array).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { PROFILE_BRIDGE, bridgeForField } from '@/domain/application/profile-bridge'
import { ALL_PROFILE_KEYS } from '@/domain/requirements/rules'

describe('PROFILE_BRIDGE', () => {
  it('covers every profile key', () => {
    const keys = PROFILE_BRIDGE.map((e) => e.key)
    for (const key of ALL_PROFILE_KEYS) expect(keys).toContain(key)
  })

  it('converts yes/no answers to booleans and back', () => {
    const entry = bridgeForField('wants_gsa')!
    expect(entry.toPatch('yes')).toEqual({ wantsGsa: true })
    expect(entry.toPatch('no')).toEqual({ wantsGsa: false })
    expect(entry.toFieldValue(true)).toBe('yes')
    expect(entry.toFieldValue(false)).toBe('no')
  })

  it('skips unanswerable patch values', () => {
    expect(bridgeForField('location_state')!.toFieldValue(null)).toBeNull()
    expect(bridgeForField('licenses_held')!.toFieldValue([])).toBeNull()
  })

  it('passes licence arrays through whole', () => {
    const entry = bridgeForField('licenses_held')!
    expect(entry.toPatch(['dealer', 'salvage'])).toEqual({ licenses: ['dealer', 'salvage'] })
    expect(entry.toFieldValue(['dealer'])).toEqual(['dealer'])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/domain/application/profile-bridge.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/domain/application/profile-bridge.ts`**

```ts
import type { FieldId } from '../field-id'
import type { ApplicantProfile, LicenseType } from '../requirements/rules'

/**
 * One fact, two homes: each determinant lives as a catalog field the panel
 * can ask and as the ApplicantProfile key the engine reads. The reducer uses
 * this table to keep them agreeing in both directions.
 */
export type BridgeEntry = {
  fieldId: FieldId
  key: keyof ApplicantProfile
  /** Field value (already schema-validated) → profile patch. */
  toPatch(value: unknown): Partial<ApplicantProfile>
  /** Patched profile value → field value; null means nothing to record. */
  toFieldValue(value: ApplicantProfile[keyof ApplicantProfile]): unknown
}

const yesNo = (value: ApplicantProfile[keyof ApplicantProfile]) =>
  value === true ? 'yes' : 'no'

export const PROFILE_BRIDGE: readonly BridgeEntry[] = [
  {
    fieldId: 'applicant_type', key: 'applicantType',
    toPatch: (v) => ({ applicantType: v as ApplicantProfile['applicantType'] }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'location_country', key: 'country',
    toPatch: (v) => ({ country: v as string }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'location_state', key: 'state',
    toPatch: (v) => ({ state: v as string }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'id_form', key: 'idForm',
    toPatch: (v) => ({ idForm: v as ApplicantProfile['idForm'] }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'address_differs', key: 'addressDiffersFromId',
    toPatch: (v) => ({ addressDiffersFromId: v === 'yes' }),
    toFieldValue: yesNo,
  },
  {
    fieldId: 'wants_gsa', key: 'wantsGsa',
    toPatch: (v) => ({ wantsGsa: v === 'yes' }),
    toFieldValue: yesNo,
  },
  {
    fieldId: 'licenses_held', key: 'licenses',
    toPatch: (v) => ({ licenses: v as LicenseType[] }),
    toFieldValue: (v) => (Array.isArray(v) && v.length > 0 ? v : null),
  },
  {
    fieldId: 'biz_country', key: 'bizCountry',
    toPatch: (v) => ({ bizCountry: v as string }),
    toFieldValue: (v) => v,
  },
]

const BY_FIELD: ReadonlyMap<FieldId, BridgeEntry> = new Map(
  PROFILE_BRIDGE.map((e) => [e.fieldId, e]),
)

export function bridgeForField(fieldId: FieldId): BridgeEntry | undefined {
  return BY_FIELD.get(fieldId)
}
```

- [ ] **Step 4: Run test, verify it passes; tsc**

Run: `npx vitest run tests/domain/application/profile-bridge.test.ts` → PASS; `npx tsc --noEmit` → paste output.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(application): profile bridge table"
```

---

### Task 6: Reducer — bridge both directions, carry licence types

**Files:**
- Modify: `src/domain/application/reducer.ts` (SET_VALUE, UPDATE_PROFILE, new `applyProfilePatch` helper)
- Test: `tests/domain/application/reducer.test.ts`

**Interfaces:**
- Consumes: `PROFILE_BRIDGE`, `bridgeForField` (Task 5); `reqKey`, `parseReqKey` (existing).
- Produces: SET_VALUE on a bridged field patches `state.profile` and resyncs; UPDATE_PROFILE additionally records field values (`status: 'confirmed'`, `provenance: { source: 'user' }`) for each patched key; any `licenses` patch writes `license_type#n` as `{ status: 'confirmed', provenance: { source: 'carried', fromFieldId: 'licenses_held' } }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/domain/application/reducer.test.ts` (reuse its existing state-builder helpers; `T` is any fixed timestamp string):

```ts
describe('profile bridge', () => {
  it('a bridged SET_VALUE patches the profile and expands requirements', () => {
    let s = createApplication('a', START, 'tok')
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'applicant_type', value: 'business',
      source: 'user', at: T,
    })
    expect(s.profile.applicantType).toBe('business')
    expect(outstandingFields(s)).toContain('licenses_held')
  })

  it('answering licenses_held carries each group type', () => {
    let s = createApplication('a', START, 'tok')
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'applicant_type', value: 'business',
      source: 'user', at: T,
    })
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'licenses_held', value: ['dealer', 'salvage'],
      source: 'user', at: T,
    })
    expect(s.profile.licenses).toEqual(['dealer', 'salvage'])
    expect(s.fields['license_type#0']).toMatchObject({
      value: 'dealer', status: 'confirmed',
      provenance: { source: 'carried', fromFieldId: 'licenses_held' },
    })
    expect(s.fields['license_type#1']?.value).toBe('salvage')
    expect(outstandingFields(s)).toContain('license_number#1')
    expect(outstandingFields(s)).not.toContain('license_type#0')
  })

  it('UPDATE_PROFILE records the bridged fields so nothing is asked twice', () => {
    let s = createApplication('a', START, 'tok')
    s = applicationReducer(s, {
      type: 'UPDATE_PROFILE', at: T,
      patch: { applicantType: 'business', state: 'GA', licenses: ['dealer'], wantsGsa: true },
    })
    expect(s.fields['applicant_type']).toMatchObject({ value: 'business', status: 'confirmed' })
    expect(s.fields['location_state']).toMatchObject({ value: 'GA', status: 'confirmed' })
    expect(s.fields['wants_gsa']).toMatchObject({ value: 'yes', status: 'confirmed' })
    expect(s.fields['licenses_held']).toMatchObject({ value: ['dealer'], status: 'confirmed' })
    expect(s.fields['license_type#0']?.value).toBe('dealer')
    const out = outstandingFields(s)
    for (const id of ['applicant_type', 'location_state', 'wants_gsa', 'licenses_held']) {
      expect(out).not.toContain(id)
    }
  })

  it('a null state patch records nothing', () => {
    let s = createApplication('a', START, 'tok')
    s = applicationReducer(s, { type: 'UPDATE_PROFILE', at: T, patch: { state: null } })
    expect(s.fields['location_state']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/domain/application/reducer.test.ts`
Expected: the four new tests FAIL (profile not patched; fields not written).

- [ ] **Step 3: Implement**

In `reducer.ts` add imports:

```ts
import { PROFILE_BRIDGE, bridgeForField } from './profile-bridge'
import { parseReqKey, reqKey } from '../requirements/key'
```

Replace the end of the `SET_VALUE` case:

```ts
      const withValue = withField(state, action.fieldId, next)
      const bare = parseReqKey(action.fieldId)
      const entry = bare.instance === null ? bridgeForField(bare.fieldId) : undefined
      if (!entry) return withValue
      return applyProfilePatch(withValue, entry.toPatch(action.value), { writeFields: false })
```

Replace the `UPDATE_PROFILE` case:

```ts
    case 'UPDATE_PROFILE':
      return applyProfilePatch(state, action.patch, { writeFields: true })
```

Add the helper next to `resyncFields`:

```ts
/**
 * The one place a profile patch lands. `writeFields` records each patched
 * key's bridged field too (agent path — the applicant said it in chat, which
 * is as explicit as typing it); the panel path already wrote its own field.
 * A licence declaration answers each group's type either way.
 */
function applyProfilePatch(
  state: ApplicationState,
  patch: Partial<ApplicantProfile>,
  opts: { writeFields: boolean },
): ApplicationState {
  const profile: ApplicantProfile = { ...state.profile, ...patch }
  const fields: ApplicationState['fields'] = { ...state.fields }

  if (opts.writeFields) {
    for (const entry of PROFILE_BRIDGE) {
      if (!(entry.key in patch)) continue
      const value = entry.toFieldValue(profile[entry.key])
      if (value === null) continue
      fields[entry.fieldId] = {
        value, status: 'confirmed', provenance: { source: 'user' },
      }
    }
  }

  for (const [index, type] of (patch.licenses ?? []).entries()) {
    fields[reqKey('license_type', index)] = {
      value: type,
      // Confirmed, not derived: the declaration itself was explicit input.
      status: 'confirmed',
      provenance: { source: 'carried', fromFieldId: reqKey('licenses_held') },
    }
  }

  const merged = { ...state, profile, fields }
  return { ...merged, fields: resyncFields(merged, profile) }
}
```

- [ ] **Step 4: Run the whole application test dir, verify green; tsc**

Run: `npx vitest run tests/domain/application` and `npx tsc --noEmit` — paste both. If an existing UPDATE_PROFILE test asserts fields stay untouched, update it to the new contract and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(reducer): profile bridge both directions with licence-type carry"
```

---

### Task 7: UI — multiselect and attest inputs

**Files:**
- Modify: `src/ui/panel/FieldInput.tsx`
- Modify: `src/ui/panel/FieldControl.tsx` (`inputTypeFor` covers the new types)
- Test: `tests/ui/panel/field-input-types.test.tsx` (create; follow the render/interaction conventions of the existing tests in `tests/ui/panel/`)

**Interfaces:**
- Consumes: `FieldDef.attestation`, `vettedCopy` from `@/domain/orchestrator/copy`.
- Produces: `multiselect` renders a checkbox per option, dispatching the full array via `onChange` (empty → `onClear`); `attest` renders the vetted certification text above a plain text input. The chat surface reuses `FieldInput` (see `blocks.tsx`), so it inherits both.

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldInput } from '@/ui/panel/FieldInput'
import { fieldDef } from '@/domain/catalog'
import { vettedCopy } from '@/domain/orchestrator/copy'

describe('multiselect', () => {
  it('dispatches the growing array and clears when emptied', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    render(
      <FieldInput
        fieldId="licenses_held" def={fieldDef('licenses_held')}
        state={undefined} onChange={onChange} onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByLabelText('Dealer'))
    expect(onChange).toHaveBeenCalledWith('licenses_held', ['dealer'])
  })

  it('unchecking the last option clears the field', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    render(
      <FieldInput
        fieldId="licenses_held" def={fieldDef('licenses_held')}
        state={{ value: ['dealer'], status: 'confirmed' }}
        onChange={onChange} onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByLabelText('Dealer'))
    expect(onClear).toHaveBeenCalledWith('licenses_held')
  })
})

describe('attest', () => {
  it('shows the certification text above the input', () => {
    render(
      <FieldInput
        fieldId="tax_certification" def={fieldDef('tax_certification')}
        state={undefined} onChange={vi.fn()} onClear={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/Under penalties of perjury/, { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/ui/panel/field-input-types.test.tsx`
Expected: FAIL — no checkbox for 'Dealer' (multiselect falls through to a text input today); no certification text.

- [ ] **Step 3: Implement**

`FieldInput.tsx` — add after the hooks, before `const isFile`:

```tsx
  if (def.type === 'multiselect') {
    const selected = Array.isArray(state?.value) ? (state.value as string[]) : []
    return (
      <div role="group" aria-label={def.label} style={{ margin: '6px 0' }}>
        {(def.options ?? []).map((o) => (
          <label
            key={o.value}
            style={{ display: 'block', fontSize: 15, color: COLOR.textPrimary, padding: '2px 0' }}
          >
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => {
                const next = selected.includes(o.value)
                  ? selected.filter((v) => v !== o.value)
                  : [...selected, o.value]
                if (next.length === 0) onClear(fieldId)
                else onChange(fieldId, next)
              }}
            />{' '}
            {o.label}
          </label>
        ))}
      </div>
    )
  }
```

and in the main return, directly above `<FieldControl`:

```tsx
      {def.type === 'attest' && def.attestation !== undefined && (
        <p style={{ fontSize: 13, color: COLOR.textPrimary, whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>
          {vettedCopy(def.attestation)}
        </p>
      )}
```

with `import { vettedCopy } from '@/domain/orchestrator/copy'` added.

`FieldControl.tsx` — extend `inputTypeFor`'s final case list with `case 'attest': case 'multiselect':` (both resolve to `'text'`; multiselect never reaches it, the case only keeps the switch total).

- [ ] **Step 4: Run tests, verify green; run the full ui dir; tsc**

Run: `npx vitest run tests/ui` and `npx tsc --noEmit` — paste both.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): multiselect and attest field inputs"
```

---

### Task 8: Prompt and tools name the full determinant set

**Files:**
- Modify: `src/domain/orchestrator/tools.ts` (setProfile description)
- Modify: `src/server/orchestrator/prompt.ts` (tool-guidance line)
- Test: `tests/domain/orchestrator/tools.test.ts` (or the nearest existing test over tool descriptions; if none asserts on descriptions, add one)

**Interfaces:**
- Consumes: nothing new. Produces: no code interface — wording only. The `profilePatch` schema already accepts `bizCountry` from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
import { TOOL_DESCRIPTIONS } from '@/domain/orchestrator/tools'

it('setProfile names every determinant the applicant can volunteer', () => {
  const description = TOOL_DESCRIPTIONS.setProfile
  for (const cue of ['individual or business', 'licences', 'GSA', 'form of ID', 'address', 'business is registered']) {
    expect(description.toLowerCase()).toContain(cue.toLowerCase())
  }
})
```

- [ ] **Step 2: Run test, verify it fails**

Expected: FAIL — description lacks the address and business-country cues.

- [ ] **Step 3: Implement**

Replace the setProfile description with:

```
Record what the applicant told you about who they are: individual or business, their state and country, which licences they hold, whether they want GSA access, which form of ID they carry, whether their address differs from the one on their ID, and which country their business is registered in. Call this as soon as they mention any of it, including in passing. The requirements engine cannot tell what to ask for until the profile is set, and a fact left unrecorded is one you will ask for twice.
```

In `prompt.ts`, extend the tool-guidance sentence to:

```
Call a tool only when one is called for: explain when the applicant asks why something is needed, setProfile the moment they tell you who they are — individual or business, licences held, GSA, form of ID, whether their address matches their ID, where their business is registered — requestDocument when a photo would answer a section faster than typing. A reply with no tool call is normal.
```

- [ ] **Step 4: Run test + orchestrator dir, verify green; tsc**

Run: `npx vitest run tests/domain/orchestrator tests/server 2>/dev/null || npx vitest run tests/domain/orchestrator`; `npx tsc --noEmit` — paste output.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(orchestrator): setProfile and prompt name the full determinant set"
```

---

### Task 9: Persona integration tests and full verification

**Files:**
- Create: `tests/integration/profile-capture.test.ts`
- Test: itself, then the full suite.

**Interfaces:**
- Consumes: everything above. `createApplication(id, profile, ownerToken)` from `@/domain/application/reducer`; `checkAgainstRequirements` from `@/server/action-guard`; `sectionPlan` from `@/domain/orchestrator/plan`.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import { sectionPlan } from '@/domain/orchestrator/plan'
import { checkAgainstRequirements } from '@/server/action-guard'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { ApplicationState } from '@/domain/application/state'

const T = '2026-08-07T12:00:00.000Z'

const START: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: null, wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

function fresh(): ApplicationState {
  return createApplication('app-1', START, 'tok')
}

/** Guard first, exactly as the action route does — a refused answer must fail the test. */
function answer(state: ApplicationState, fieldId: string, value: unknown): ApplicationState {
  const action = { type: 'SET_VALUE', fieldId, value, source: 'user', at: T } as const
  const refusal = checkAgainstRequirements(state, action)
  expect(refusal).toBeNull()
  return applicationReducer(state, action)
}

describe('persona: US individual', () => {
  it('starts at the profile section with the determinants, and never sees business', () => {
    const s = fresh()
    const plan = sectionPlan(s)!
    expect(plan.section).toBe('profile')
    expect(plan.fieldIds).toContain('applicant_type')
    expect(plan.fieldIds).not.toContain('licenses_held')

    const settled = answer(s, 'applicant_type', 'individual')
    const out = outstandingFields(settled)
    expect(out).not.toContain('biz_name')
    expect(out).not.toContain('tax_certification')
  })
})

describe('persona: US business with two licences', () => {
  it('unlocks licences, business, and the tax trio as answers land', () => {
    let s = fresh()
    s = answer(s, 'applicant_type', 'business')
    expect(outstandingFields(s)).toContain('licenses_held')

    s = answer(s, 'licenses_held', ['dealer', 'salvage'])
    const out = outstandingFields(s)
    expect(s.fields['license_type#0']?.value).toBe('dealer')
    expect(s.fields['license_type#1']?.value).toBe('salvage')
    expect(out).toContain('license_number#0')
    expect(out).toContain('license_number#1')
    expect(out).toContain('tax_classification')
    expect(out).toContain('tax_certification')
    expect(out).not.toContain('license_type#0')
  })

  it('refuses an empty licence declaration', () => {
    let s = fresh()
    s = answer(s, 'applicant_type', 'business')
    const refusal = checkAgainstRequirements(s, {
      type: 'SET_VALUE', fieldId: 'licenses_held', value: [], source: 'user', at: T,
    })
    expect(refusal).toContain('Select at least one license')
  })
})

describe('persona: non-US applicant', () => {
  it('swaps to region and postal, and drops the state ask', () => {
    let s = fresh()
    s = answer(s, 'location_country', 'CAN')
    const out = outstandingFields(s)
    expect(out).toContain('addr_region')
    expect(out).toContain('addr_postal')
    expect(out).not.toContain('addr_state')
    expect(out).not.toContain('location_state')
  })
})

describe('persona: GSA and address-differs', () => {
  it('wants_gsa yes unlocks the gsa section; no keeps it out', () => {
    let yes = fresh()
    yes = answer(yes, 'wants_gsa', 'yes')
    expect(outstandingFields(yes)).toContain('gsa_bidder_number')

    let no = fresh()
    no = answer(no, 'wants_gsa', 'no')
    expect(outstandingFields(no)).not.toContain('gsa_bidder_number')
  })

  it('address_differs yes requires proof of residency', () => {
    let s = fresh()
    s = answer(s, 'address_differs', 'yes')
    expect(outstandingFields(s)).toContain('proof_of_residency')
  })
})

describe('volunteered facts are never asked twice', () => {
  it('a setProfile patch settles the bridged asks', () => {
    let s = fresh()
    s = applicationReducer(s, {
      type: 'UPDATE_PROFILE', at: T,
      patch: { applicantType: 'business', state: 'GA', licenses: ['dealer'] },
    })
    const out = outstandingFields(s)
    expect(out).not.toContain('applicant_type')
    expect(out).not.toContain('location_state')
    expect(out).not.toContain('licenses_held')
    expect(out).not.toContain('license_type#0')
    expect(out).toContain('license_number#0')
  })
})
```

- [ ] **Step 2: Run the file — every test must pass against the completed Tasks 1–8**

Run: `npx vitest run tests/integration/profile-capture.test.ts`
If anything fails, the defect is in a prior task — fix it there, do not weaken the test. Then sabotage-check one assertion (e.g. comment out the licence-carry loop in the reducer) and confirm the suite goes red; restore it.

- [ ] **Step 3: Full verification**

Run: `npx vitest run` (full suite — record the count; it was 1036 before this feature) and `npx tsc --noEmit`. Paste both outputs.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(integration): profile-capture personas end to end"
```

---

## After the tasks

- Chrome walk (drive-the-app-as-a-real-user): create a fresh application, answer `applicant_type` business in the chat panel, watch licences/business/tax appear; flip `location_country` to Canada and watch the address block swap. Screenshots in the task report.
- The `w9_certification` copy entry joins the legal-review batch (with `done_chip`, `section_incomplete`, `panel_only_notice`) — noted in memory, not a code task.
- Known non-goals are listed in the spec §10.
