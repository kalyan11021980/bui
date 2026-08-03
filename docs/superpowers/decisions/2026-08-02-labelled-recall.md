# Labelled-document extractor — recall result

**Date:** 2026-08-02
**Strategy:** `src/domain/ocr/extract/labelled.ts` (`extractLabelled`)
**Corpus:** `sample/licenses/fixtures/dealer_license.json`,
`chicago_utility_bill.json`, `bank_statement.json`

## The question this task asked

> Run the weakest of the three extraction strategies — no printed field codes,
> no check digits, only a plain-English label beside each value — against the
> real fixtures, and report the number. A low number is a finding, not a
> failure.

## Verdict

**Keep as is.** The dealer licence clears its floor and reads everything the
anchor table currently targets on it. The two proof-of-residency documents
read nothing, and that is not this strategy's ceiling to raise — no text
field in the catalog is derivable from `proof_of_residency` at all, so
nothing an extractor emits for one can ever reach a form field. That is a
catalog question, stated in full below, not a synonym-table gap.

## What was measured

| Document | docType | Fields read | Ground truth from |
|---|---|---|---|
| `dealer_license.json` | `dealer_license` | **4/4** of what the table targets — `license_number#0`, `license_effective#0`, `license_expiry#0`, `biz_legal_name` | `sample/licenses/synthetic/dealer_license.png`, read by eye |
| `chicago_utility_bill.json` | `proof_of_residency` | **0** | N/A — nothing to check against |
| `bank_statement.json` | `proof_of_residency` | **0** | N/A — nothing to check against |

`tests/domain/ocr/extract/labelled-recall.test.ts` locks these counts and the
exact key sets, so a change to any of them has to be argued for in a diff.

### Dealer licence — verified against the image, not the OCR text

I read `sample/licenses/synthetic/dealer_license.png` directly. It prints, top
to bottom: `LICENSE NUMBER` / `DLR-0000-4471`, `LICENSE TYPE` / `USED MOTOR
VEHICLE DEALER`, `BUSINESS NAME` / `SPECIMEN AUTO SALES LLC`, `DOING BUSINESS
AS` / `SAMPLE MOTORS`, `BUSINESS ADDRESS` / `100 SPECIMEN ROAD` / `FRANKLIN
CITY, FR 00000`, `EFFECTIVE DATE` / `03/01/2025`, `EXPIRATION DATE` /
`02/28/2027`. This matches `synthetic/dealer_license_truth.json` field for
field — that file is documented in `sample/licenses/SOURCES.md` as "unverified
against the rendered image," and this is that verification. It now stands as
checked, for the eight values above, not merely generated.

The strategy reads 4 of the 8 printed pairs: the licence number, both dates,
and — mapped through the existing `BUSINESSNAME` anchor — the field the
catalog calls `biz_legal_name`. `LICENSE TYPE` and `DOING BUSINESS AS` have no
entry in `LABELLED_ANCHORS` and were not added, since neither `license_type`
nor `biz_name` declares `dealer_license` in `derivableFrom` — reading them
would produce a candidate `extractFor` immediately drops. The business
address (`biz_addr_line1/city/state/zip`, all four **are** derivable from
`dealer_license`) is also unread: the anchor table has no `BUSINESS ADDRESS`
entry and no multi-line address parser. That is a real, known gap — line 2 of
the printed address (`FRANKLIN CITY, FR 00000`) needs the same
label-then-city/state/zip logic `aamva.ts` already has for cards, ported to a
two-detection label/value layout. It was left out rather than added under
this task, for the reason in the section below.

Counted against the full set of fields the catalog says a `dealer_license`
*could* prove — `license_number`, `license_effective`, `license_expiry`,
`license_country`, `biz_legal_name`, `biz_addr_line1`, `biz_addr_city`,
`biz_addr_state`, `biz_addr_zip`, nine fields — the strategy reads **4/9
(44%)**. `license_country` is unreadable on principle: `STATE OF FRANKLIN` is
fictional, so there is no real value to check it against.

### Proof of residency — zero, and why it is not a synonym gap

Neither `chicago_utility_bill.json` nor `bank_statement.json` contains any of
the anchor phrases `LABELLED_ANCHORS` knows — no "License Number", "Effective
Date", "Expires" or "Legal Name" appears on a utility bill or a bank
statement. Adding anchors for what these documents *do* print (`Utility
Service Address`, `Account No.`) would not help: **no catalog field lists
`proof_of_residency` in `derivableFrom` except `proof_of_residency` itself**,
which is a `file`-type upload
(`z.array(z.string().min(1))`), not a text field. `extractFor`'s `derivable()`
guard drops any text candidate for a document type absent from the target
field's own list, so even a hand-transcribed, perfect read of "456 BROADWAY
AVE, CHICAGO, IL 60622-3208" off the Chicago bill would be discarded before it
reached a form field. `tests/domain/ocr/extract/labelled-recall.test.ts`
asserts this directly against `CATALOG`, so it is checked rather than
recalled from this document.

This is deliberate on the catalog's part, not an oversight `extractFor`
happens to trigger on: `addr_line1/city/state/zip` (the fields a residency
document would answer) declare `derivableFrom: ['drivers_license',
'state_id']` — i.e. the applicant's home address is meant to come off their
ID, and `proof_of_residency` exists to confirm it when the two disagree, not
to originate it. Whether that is still the right call once OCR exists is the
open question.

## What this does not license

**It does not mean the labelled strategy is broken for residency documents.**
Given a `derivableFrom` update, `extractLabelled` would need real address
parsing to do anything with a utility bill or a bank statement — the anchor
table today has no entry for an address at all, labelled or not. The zero
recorded here is the product of two independent facts (no matching anchors,
and no derivable target), and fixing only the catalog side would still leave
recall at zero until the extractor grows an address reader.

**It does not mean 44% is the ceiling for dealer licences either.** The
business address is readable in principle — it is printed, labelled, and
derivable — and was left out specifically so this number would not be
massaged by adding exactly enough parsing to clear a target set by the same
person doing the measuring. That is real headroom, not a defect.

**One fixture is not a population.** `dealer_license.json` is synthetic —
`sample/licenses/SOURCES.md` records that no US state publishes a specimen of
an issued dealer licence, so this is our own layout guess, not a sampled
distribution of how real dealer boards typeset theirs. 4/4 (or 4/9) on one
self-authored document says the algorithm works on a document shaped like the
one document we have. It says nothing about how many real dealer-licence
layouts put the label above the value versus beside it, merge it into one
OCR detection versus splitting it into two, or use a synonym this table does
not carry.

## Options for the open catalog question

1. **Add `proof_of_residency` to `derivableFrom` for `addr_line1/city/state/zip`**,
   alongside `drivers_license` and `state_id`. Lets a utility bill or bank
   statement originate an address, not just confirm one. Requires the
   extractor to actually parse one (not yet built) before it does anything.
2. **Leave the catalog as is.** A residency document stays confirmation-only;
   `extractLabelled`'s registration for `proof_of_residency` is inert until
   the catalog changes, and that inertness is now measured rather than
   assumed.
3. **A dedicated `proof_of_residency_addr_*` field**, distinct from the
   ID-derived address, if the product wants to carry both and let a human
   compare them rather than treating one as ground truth for the other.

This is a product/catalog call, not an extraction one, and it is not made
here.

## Recommendation

Keep `extractLabelled` as implemented. Do not extend `LABELLED_ANCHORS`
further to chase the dealer-licence number up — 4/4 of the current target set
and the required floor (`license_number#0`) are both met on the one fixture
available. Do not cut the strategy to Phase 2b: the dealer-licence half works
and is in scope; the proof-of-residency half is correctly inert pending a
decision this document cannot make. Revisit business-address parsing for
dealer licences, and residency-document address parsing entirely, once more
than one real specimen of each exists to measure against — extending either
against a single self-authored fixture would tune the table to our own guess
at a layout, not to the world.
