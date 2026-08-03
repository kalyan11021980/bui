# Specimen sources

Every image here is an official **sample** published by the issuing authority,
printed with a placeholder identity — or, in exactly one case, rendered by us
and labelled synthetic. **None is a real person's document.** The corpus is
listed in `manifest.json`; the recorded reads are in `fixtures/`.

## AAMVA cards

Retrieved 2026-08-02.

| File | Source title | Source | Size | Licence |
|---|---|---|---|---|
| `specimens/wa_enhanced.png` | *Washington State Enhanced Driver's License - Sample* | Wikimedia Commons | 1560×1006 | **CC BY-SA 4.0** |
| `specimens/ma_2016.png` | *Massachusetts-drivers-license sample, 2016* | Wikimedia Commons | 795×501 | Public domain |
| `specimens/dc_2018.png` | *Washington, D.C. sample driver's license, c. 2018* | Wikimedia Commons | 696×441 | Public domain |
| `specimens/ca_2019.png` | *Californian sample driver's license, c. 2019* | Wikimedia Commons | 602×385 | Public domain |
| `specimens/or_2020.png` | *REAL ID compliant cards, 21 and over* | [Oregon DMV](https://www.oregon.gov/odot/dmv/pages/driverid/samplecards.aspx) | 700×416 | **Oregon state work, no explicit grant** |
| `specimens/va_2023.png` | *Over 21 Driver's License, REAL ID Compliant, Veteran Indicator* | [Virginia DMV media page](https://www.dmv.virginia.gov/news/media) | 721×473 | **Virginia state work, "available for media use"** |
| `specimens/va_id_2023.png` | *Over 21 Identification Card, Non-REAL ID Compliant, Veteran Indicator* | [Virginia DMV media page](https://www.dmv.virginia.gov/news/media) | 721×473 | **Virginia state work, "available for media use"** |
| `specimens/ca_id_2010.png` | *Identity card of the State of California, sample (2010)* | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Identity_card_of_the_State_of_Califorinia,_sample_(2010).jpg) | 652×411 | Public domain (`PD-CA-Gov`) |
| `specimens/md_1977.png` | *Maryland sample driver's license, c. 1977* | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Maryland_sample_driver%27s_license,_c._1977.png) | 658×412 | Public domain (`PD-US-no notice`) |

Placeholder identities, in order: `JANE SAMPLE`, `CONNOR SAMPLE`,
`ANGELINA GABRIELA JONES`, `IMA CARDHOLDER`, `OREGON SAMPLE, SR`,
`RICHARD BENJAMIN REYES`, `JAMES ALAN SARKO`, `SEIJI SAMPLE`,
`JANE ELIZABETH DOE`.

The two Virginia cards are the only ones whose placeholder is not self-evident
from the name. They are established as specimens by their printed addresses:
`5235 JOHN TYLER HWY, WILLIAMSBURG` and `110 EAST MIDLAND TRL, LEXINGTON` are
the DMV's own Williamsburg and Lexington customer service centres, not
residences. DMV publishes both as card-design graphics on its press page.

`md_1977` predates AAMVA and is typewritten rather than laid out to the
standard. It is in the corpus for exactly that reason — a legacy layout the
label-driven extractor has to fail gracefully on, not silently mis-parse.

## Passport

| File | Source title | Source | Size | Licence |
|---|---|---|---|---|
| `specimens/nl_passport_2014.png` | *Dutch passport specimen issued 9 March 2014* | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Dutch_passport_specimen_issued_9_March_2014.jpg), from [RvIG](https://www.rvig.nl/reisdocumenten/voorlichtingsmateriaal-reisdocumenten/rechtenvrije-fotos-reisdocumenten-model-2014) | 1500×1132 | CC0 |

Published by the Rijksdienst voor Identiteitsgegevens as royalty-free
publicity material for the 2014 travel document model. Holder is
`DE BRUIJN, WILLEKE LISELOTTE`, place of birth `Specimen`, document number
`SPECI2014`; the page is overprinted SPECIMEN. Cropped from the two-page
spread to the data page and resampled to 1500px wide.

Both MRZ lines read. Neither reads perfectly — the recorded read gives
`SPEC120142NLD…` for `SPECI20142NLD…` and drops filler characters off both
line ends. That is the point: the extractor's check-digit validation has to
survive it.

## Dealer licence — **synthetic**

| File | Source | Size | Licence |
|---|---|---|---|
| `synthetic/dealer_license.png` | **Rendered by `tools/ocr-gate/render_cards.py dealer`** | 1275×990 | Ours |

**No US state publishes a specimen of an issued dealer licence.** Searched
Wikimedia Commons, and the dealer handbooks and licensing pages of Kansas,
North Dakota, Texas, Michigan, New Jersey, Florida, California and New York:
all publish application *forms*, none an image of the certificate. So this one
is invented rather than sourced.

It is issued by the `STATE OF FRANKLIN`, which is not a state, to
`SPECIMEN AUTO SALES LLC`, and carries the footer
`SYNTHETIC SPECIMEN - NOT AN ISSUED LICENSE`. Field values and boxes are in
`synthetic/dealer_license_truth.json`. **Recall numbers measured against it
say nothing about real dealer licences** — it was laid out by us, so an
extractor tuned to it is tuned to our own guess at the layout.

## Proof of residency

| File | Source title | Source | Size | Licence |
|---|---|---|---|---|
| `specimens/chicago_utility_bill_2016.png` | *Sample metered bill* | [City of Chicago Department of Finance](https://www.chicago.gov/content/dam/city/depts/fin/garbagefee/sample-metered-bill.pdf) | 1500×1893 | **Chicago municipal work, no explicit grant** |
| `specimens/bank_statement_2003.png` | *BankStatementChequing.png* | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:BankStatementChequing.png) | 690×533 | **CC BY-SA 3.0**, Sergio Ortega |

The Chicago bill bills `SAM SAMPLE` at `123 MAIN ST, CHICAGO, IL 60622-3208`.
The bank statement is a fictional `FIRST BANK OF WIKI` statement for
`JOHN JONES` in Toronto — a Canadian address, so it exercises a non-US postal
format rather than a ZIP.

## Licences that constrain what can leave the company

Four entries are not public domain. Attribution and share-alike bite on
**derivatives** — an annotated crop in a published report, a screenshot in a
sales deck. Internal benchmarking is unaffected.

- `wa_enhanced.png` — **CC BY-SA 4.0**. Attribution and share-alike.
- `bank_statement_2003.png` — **CC BY-SA 3.0**, credit Sergio Ortega.
  Attribution and share-alike.
- `or_2020.png`, `va_2023.png`, `va_id_2023.png`,
  `chicago_utility_bill_2016.png` — US state or municipal works. **US
  government copyright waiver applies only to federal works**, so these carry
  no licence grant at all; they are published by the issuing authority for
  identification and press use and are used here on that basis. Do not
  redistribute them as standalone assets.

Everything else is public domain or CC0 and unencumbered.

## What was rejected, and why

- *Ketty Maus specimen passport 2026* (Luxembourg, Commons, PD) — a genuine
  specimen, but photographed with the right edge and the second MRZ line
  cropped. A passport whose MRZ cannot be read whole is not a passport fixture.
- *Californian sample driver's license, 2025*, *Massachusetts sample driver's
  license, 2006* — genuine specimens, but California and Massachusetts are
  already covered and the task wanted new states.
- *New Mexico standard horizontal driver identification card* (Commons SVG) —
  a contributor's reconstruction of the design, not an issued specimen.
  Passing it off as sourced would have been the same defect as an unlabelled
  synthetic.
- Everything in `Category:Driver's licenses of the United States` naming a
  person — *BTK victim Vicki Wegerle's license*, the 9/11 hijacker licences,
  the celebrity licences. Real people's documents. Not eligible on any terms.
- Utility-bill and bank-statement "templates" from commercial template sites.
  Unclear provenance and unclear licensing; published municipal samples are
  strictly better on both counts.

## Resolution, and why it flatters nothing

At a real card width of 3.375in the nine cards work out to roughly 462, 236,
206, 178, 207, 214, 214, 193 and 195 dpi. A phone capture of a card filling the
frame is typically higher. So on resolution these are, if anything, a **harder**
test than production capture — the opposite of the usual worry about clean
benchmark data.

They are still easier than production in every other way: no glare, no skew, no
shadow, no motion blur. The Washington and Massachusetts cards carry heavy
security overprint (a diagonal SAMPLE band, a dove hologram over the date
block), and the Oregon crop keeps the edges of the two cards stacked behind it;
those are the closest thing here to real-world interference.

## One recorded read is degenerate, on purpose

`fixtures/md_1977.json` has a 38 KB `plainText`: the plain prompt fell into a
repetition loop on the low-contrast 1977 card, emitting `AUTHORIZING AUTHORITY`
1184 times. The grounded read of the same card is fine — 28 detections, name,
address and licence number all correct.

It is committed as recorded rather than trimmed. Anything that concatenates
`plainText` across the corpus needs to expect this.

## Conversions

All files are `.png`. The four original cards were converted from `.webp` and
`.jpg` with no resampling. Of the new material:

- `or_2020.png` — front card cropped out of the published three-card stack.
- `nl_passport_2014.png` — data page cropped from the two-page spread, then
  resampled from 2180px to 1500px wide.
- `chicago_utility_bill_2016.png` — page 1 rasterised from PDF, top margin
  cropped, resampled to 1500px wide.
- `va_2023.png`, `va_id_2023.png`, `ca_id_2010.png`, `md_1977.png`,
  `bank_statement_2003.png` — format conversion only, dimensions unchanged.
