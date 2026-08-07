# Profile capture and missing IAA inputs

**Date:** 2026-08-06
**Amends:** `2026-08-05-section-flow-design.md` (the profile section gains fields that
reshape the walk) and `2026-08-03-phase-3-agent-design.md` (`setProfile` gains a
mirror into field state).
**Depends on:** everything merged to main at `8733176`.

## 1. What this delivers

An audit of `~/Desktop/iaa.docx` against the shipped flow found that the six inputs
deciding an application's shape — business or individual, state, licences held, form
of ID, GSA opt-in, whether the address differs from the ID — are engine inputs on
`ApplicantProfile` that nothing ever asks. The planner only asks catalog fields, the
agent is forbidden to ask, and the panel does not ask up front. Every application
therefore runs on `STARTING_PROFILE` (individual, US, driver's license, no licences,
no GSA) unless the applicant volunteers otherwise, and the business, license, tax,
gsa and state_forms sections are unreachable in a normal conversation.

After this phase, the determinants are catalog fields asked first, like anything
else; answering them expands the application; and the fields IAA requires that we
never modeled — primary phone, address country, W-9 line 3 and certification, POA
and bid-card uploads — exist.

## 2. Decisions taken before design

| Decision | Choice |
|---|---|
| Profile capture | Promote the determinants to catalog fields in the `profile` section. Confirmed answers patch `ApplicantProfile`. No new block kinds; the planner stays the only asker. |
| Non-US addresses | Country asked once (profile) for the personal address, per-block for business. US keeps today's state select + ZIP validation; any other country swaps in free-text region and postal fields. No per-country region data. |
| W-9 | Add the line-3 federal tax classification select **and** a typed-name attestation over the Part II certification text (IRS-prescribed, used verbatim). The DocuSign-style signing integration stays out. |
| POA / bid cards | Field definitions added following the Ohio pattern; inert until a compliance owner signs off a `STATE_RULES` entry that references them. No state mappings invented by developers. |
| Licence invariant | `licenses_held` is asked only of businesses and validates at ≥ 1 entry, so a business cannot settle the profile section licence-less; individuals are never asked (IAA: "Individual without business license(s)"). |

## 3. New profile fields and the bridge

### 3.1 Fields

New `src/domain/catalog/profile.ts` (`preferences.ts` keeps activity and language):

| Field id | Type | Profile key | Asked when |
|---|---|---|---|
| `applicant_type` | `select` (business / individual) | `applicantType` | always |
| `location_country` | `select` | `country` | always |
| `location_state` | `select` (US states) | `state` | `country === 'US'` |
| `id_form` | `select` (driver's license / state ID / passport) | `idForm` | always |
| `address_differs` | `select` (yes / no) | `addressDiffersFromId` | always |
| `licenses_held` | `multiselect` (dealer / dismantler / exporter / salvage), min 1 | `licenses` | `applicantType === 'business'` |
| `wants_gsa` | `select` (yes / no) | `wantsGsa` | always |
| `biz_country` | `select` | `bizCountry` (new key) | business section, see §4 |

`applicant_type`, `licenses_held` are `neverBulkConfirm`. `ApplicantProfile` gains
`bizCountry: string | null`; `ALL_PROFILE_KEYS` and its compile-time completeness
check pick it up, and `profilePatch` in `action-schema.ts` accepts it.

`CORE_PROFILE` becomes `profileFields(profile)` with the conditional-emission rules
above, ordered: determinants, then `primary_activity`, `preferred_language`.
`STARTING_PROFILE` keeps its defaults — the engine needs values to compute with —
but a default no longer decides anything the applicant was not asked, because the
fields sit first in the walk and the plan is re-derived every turn.

### 3.2 The bridge (reducer-level, both directions)

A `PROFILE_BRIDGE` table in the domain maps each field above to its profile key and
value conversions (`toPatch` / `fromProfile`).

- **`SET_VALUE` on a bridged field** also applies the corresponding patch to
  `state.profile`, in the same reducer case — atomic, and no route can miss it.
- **`UPDATE_PROFILE`** (the agent's `setProfile` on volunteered facts) also writes
  each patched key's field value (source `user`), so a volunteered "I'm a dealer in
  Georgia" is never asked again — the exact double-ask `tools.ts` warns about.
- **No loop:** the patch a bridged `SET_VALUE` applies is plain data; it does not
  re-enter the bridge.
- **Licence carry:** when `licenses` is patched (either direction), each group's
  `license_type#n` is written as a `carried` value with
  `fromFieldId: 'licenses_held'` — the applicant declared the types once; the group
  should not ask again. Shrinking the array later orphans higher-instance field
  state harmlessly: `requiredFields` no longer lists those keys, which is the
  existing behaviour for shrinking `licenses`.

## 4. Address country

- Personal address: no new ask — the variant is driven by `profile.country`,
  answered in the profile section. `CORE_ADDRESS` becomes `addressFields(profile)`:
  US → `addr_state` (select) + `addr_zip` (ZIP schema); otherwise → new free-text
  `addr_region` + `addr_postal`.
- Business address: `biz_country` is asked inside the business section (a business
  may be registered somewhere other than where the applicant lives) and bridges to
  `profile.bizCountry`. `BUSINESS_CORE` becomes `businessFields(profile)` with the
  same US / non-US swap (`biz_addr_region`, `biz_addr_postal`). `bizCountry: null`
  is treated as US — the common case — and the derived plan swaps the moment the
  answer lands.

## 5. Straightforward additions

- `phone_primary` (`phone`, required) joins `phone_mobile` in `CORE_CONTACT` — the
  IAA address screen requires both (its validation error is visible in the doc).
- `tax_classification` (`select`, the seven W-9 line-3 options: individual/sole
  proprietor, C corporation, S corporation, partnership, trust/estate, LLC, other),
  destination "W-9, line 3", required alongside `tax_id` for businesses.

## 6. W-9 attestation

New field type `attest`. The renderer shows the W-9 Part II certification text —
new copy id `w9_certification`, the IRS-prescribed wording verbatim (public
government text; revision cited in the copy entry) — above a typed-full-name input.
The stored value is the typed name; the timestamp is the action's `at`.
`tax_certification` is required with the other tax fields for businesses, and is
`neverBulkConfirm`. The copy entry joins the legal-review batch alongside
`done_chip`, `section_incomplete` and `panel_only_notice`. `COPY_VERSION` bumps.

## 7. State forms

`poa_form` and `bid_card` file fields join `state-forms.ts` following
`oh_foreign_buyer_form`: defined, validated, and inert until a `STATE_RULES` entry
references them with a compliance owner's `signedOff: true`. A note in `rules.ts`
records that the two exist and await sign-off.

## 8. Prompt, tools, UI

- `setProfile`'s description and the system prompt name the full determinant set
  (including GSA and address-differs) so volunteered facts are recorded. The agent
  still never authors questions; the planner now asks them.
- Two new render types in the panel `FieldRow` and chat blocks — `multiselect`
  (checkbox group) and `attest` (vetted certification copy above a name input) —
  extensions of the existing type-render map. Yes/no questions are ordinary
  selects; the string-draft input pipeline stays untouched. No new OpenUI
  components.

## 9. Testing

TDD throughout. Engine and reducer units, plus integration tests that drive the
personas end to end:

1. US individual — no business/license/tax/gsa sections ever presented.
2. US business, two licences — `licenses_held` answered → two licence groups with
   `license_type#n` pre-carried; tax section includes classification and
   attestation.
3. Non-US exporter — free-text region/postal in both address blocks.
4. GSA opt-in — gsa section appears; opt-out — it never does.
5. Invariant — business with zero licences cannot settle the profile section.
6. Volunteered-info dedup — `setProfile` patch → bridged fields answered → no
   re-ask in the next plan.
7. Bridge round-trip — panel answer patches profile; profile patch answers field.

## 10. Out of scope

- W-9 e-signature integration (DocuSign or equivalent).
- STATE_RULES content for any state (compliance-owner work; the fields are ready).
- Optional IAA inputs: address 2, ext, fax, phone 2.
- The resume-flow dedup risk recorded in memory (unchanged by this work).
