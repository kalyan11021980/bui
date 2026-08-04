import { isRealCalendarDate } from '@/domain/calendar'
import type { FieldId } from '@/domain/field-id'
import { reqKey } from '@/domain/requirements/key'
import { isPlausibleBox } from '../geometry'
import { normalizeText, type Box, type Detection } from '../grounding'
import { registerStrategy } from './index'
import { isLabel, LABELLED_ANCHORS, LABELLED_LABEL_WORDS } from './synonyms'
import { glyphAmbiguity, NO_EVIDENCE, type Candidate, type ExtractStrategy } from './types'

const US_DATE = /(\d{2})[/-](\d{2})[/-](\d{4})/
const DATE_FIELDS = new Set(['license_effective', 'license_expiry'])
/** The requirements engine instances licences; a bare key answers nothing. */
const INSTANCED = new Set(['license_number', 'license_effective', 'license_expiry'])

/**
 * A licence number is an identifier, not free text — it always carries a
 * digit. Mirrors `aamva.ts`'s `isNumber`, and for the same reason: without a
 * shape check, `adjacentValue` has no way to prefer a real value over a
 * plausible-looking neighbour that happens to be nearest.
 */
const ACCEPTS: Readonly<Record<string, (raw: string) => boolean>> = {
  license_number: (raw) => /\d/.test(raw),
}
const accepts = (field: string): (raw: string) => boolean => ACCEPTS[field] ?? (() => true)

/** Codes and words survive normalisation; everything else is scenery. */
function bareKey(text: string): string {
  return normalizeText(text).replace(/[^A-Z0-9#]/g, '')
}

type IsoDate = { readonly iso: string; readonly asRead: string }

/** Cards print MM/DD/YYYY; every field schema wants ISO. */
function isoFrom(raw: string): IsoDate | null {
  const match = US_DATE.exec(raw)
  if (!match) return null
  const [asRead, month, day, year] = match
  const iso = `${year}-${month}-${day}`
  return isRealCalendarDate(iso) ? { iso, asRead } : null
}

/**
 * A value glued onto its own label in one detection, e.g. "License No. X-1".
 * `normalizeText` strips all whitespace, so a label spelled across two words
 * with nothing after it ("EFFECTIVE DATE") and a genuinely merged label and
 * value ("LIC# WDLJK00580GF" — real DeepSeek behaviour, see the acceptance
 * gate record) look identical: an anchor immediately followed by a letter.
 * Rejecting the remainder only when it is *itself* one whole label word
 * (`DATE`, `TYPE`...) tells them apart; a blanket "next character is a
 * letter" rule was tried first and silently drops every merged
 * letter-leading value, which is undocumented in
 * `docs/superpowers/decisions/2026-08-02-labelled-recall.md`.
 */
function inlineValue(normalized: string, anchor: string): string | null {
  const at = normalized.indexOf(anchor)
  if (at === -1) return null
  const rest = normalized.slice(at + anchor.length).replace(/^[:.#]+/, '')
  if (!rest || LABELLED_LABEL_WORDS.includes(rest)) return null
  return rest
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()

const MAX_GAP = 80
const overlapsX = (a: Box, b: Box): boolean => Math.min(a[2], b[2]) > Math.max(a[0], b[0])
const overlapsY = (a: Box, b: Box): boolean => Math.min(a[3], b[3]) > Math.max(a[1], b[1])
const gapRight = (anchor: Box, box: Box): number => box[0] - anchor[2]
const gapBelow = (anchor: Box, box: Box): number => box[1] - anchor[3]

/**
 * Most labelled documents print a label and its value as two separate
 * detections, label above value — unlike an AAMVA card, which often runs
 * them together in one string. A value to the right wins a tie; nothing in
 * this corpus prints that way, but a spreadsheet-style form might.
 *
 * Candidates are filtered through `isLabel` before distance ever matters: OCR
 * can lose a value while keeping its label (the acceptance gate's ZIP
 * misread is the same failure shape), which otherwise leaves the *next*
 * label down the page as the nearest neighbour and no way to tell it from a
 * real value.
 */
function adjacentValue(
  detections: readonly Detection[],
  label: Detection,
  valueAccepts: (raw: string) => boolean,
): Detection | null {
  const usable = (d: Detection): boolean =>
    d !== label && !isLabel(bareKey(d.text), LABELLED_LABEL_WORDS, [])
      && valueAccepts(clean(d.text))

  const right = detections
    .filter((d) => usable(d) && overlapsY(label.box, d.box) && gapRight(label.box, d.box) >= 0
      && gapRight(label.box, d.box) <= MAX_GAP)
    .sort((a, b) => gapRight(label.box, a.box) - gapRight(label.box, b.box))
  if (right[0]) return right[0]

  const below = detections
    .filter((d) => usable(d) && overlapsX(label.box, d.box) && gapBelow(label.box, d.box) >= 0
      && gapBelow(label.box, d.box) <= MAX_GAP)
    .sort((a, b) => gapBelow(label.box, a.box) - gapBelow(label.box, b.box))
  return below[0] ?? null
}

type Found = { readonly raw: string; readonly box: Box }

/** The first anchor with a value: inline on its own detection, or the nearest neighbour. */
function findLabelled(
  detections: readonly Detection[],
  anchors: readonly string[],
  valueAccepts: (raw: string) => boolean,
): Found | null {
  for (const anchor of anchors) {
    const wanted = normalizeText(anchor)
    for (const detection of detections) {
      const normalized = normalizeText(detection.text)
      if (!normalized.includes(wanted)) continue

      const inline = inlineValue(normalized, wanted)
      if (inline && valueAccepts(inline)) return { raw: inline, box: detection.box }

      const neighbour = adjacentValue(detections, detection, valueAccepts)
      if (neighbour) return { raw: clean(neighbour.text), box: neighbour.box }
    }
  }
  return null
}

/**
 * Reads a document that carries no printed field codes, only a plain-English
 * label beside each value — a dealer licence or a proof-of-residency
 * document. Weakest of the three strategies by design: no checksum, no fixed
 * layout, nothing but the label text itself to anchor on.
 */
export const extractLabelled: ExtractStrategy = (detections) => {
  const out: Candidate[] = []

  for (const [field, anchors] of Object.entries(LABELLED_ANCHORS)) {
    const found = findLabelled(detections, anchors, accepts(field))
    if (!found) continue

    const parsed: IsoDate | { iso: string; asRead?: undefined } | null =
      DATE_FIELDS.has(field) ? isoFrom(found.raw) : { iso: found.raw }
    if (!parsed) continue
    const raw = parsed.iso

    const key = INSTANCED.has(field) ? reqKey(field as FieldId, 0) : field
    out.push({
      key,
      raw,
      ...(parsed.asRead !== undefined && { asRead: parsed.asRead }),
      box: found.box,
      evidence: {
        ...NO_EVIDENCE,
        labelAnchored: true,
        boxPlausible: isPlausibleBox(found.box),
        glyphAmbiguous: glyphAmbiguity(key, raw),
      },
    })
  }

  return out
}

registerStrategy('dealer_license', extractLabelled)
