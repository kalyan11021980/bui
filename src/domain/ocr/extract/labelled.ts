import { isRealCalendarDate } from '@/domain/calendar'
import type { FieldId } from '@/domain/field-id'
import { reqKey } from '@/domain/requirements/key'
import { isPlausibleBox } from '../geometry'
import { normalizeText, type Box, type Detection } from '../grounding'
import { registerStrategy } from './index'
import { LABELLED_ANCHORS } from './synonyms'
import { glyphAmbiguity, NO_EVIDENCE, type Candidate, type ExtractStrategy } from './types'

const US_DATE = /(\d{2})[/-](\d{2})[/-](\d{4})/
const DATE_FIELDS = new Set(['license_effective', 'license_expiry'])
/** The requirements engine instances licences; a bare key answers nothing. */
const INSTANCED = new Set(['license_number', 'license_effective', 'license_expiry'])

/** Cards print MM/DD/YYYY; every field schema wants ISO. */
function isoFrom(raw: string): string | null {
  const match = US_DATE.exec(raw)
  if (!match) return null
  const [, month, day, year] = match
  const iso = `${year}-${month}-${day}`
  return isRealCalendarDate(iso) ? iso : null
}

/**
 * A value glued onto its own label in one detection, e.g. "License No. X-1".
 * Rejects a match where the character after the anchor continues a word
 * instead of starting a value — without this, "EFFECTIVE" reads "DATE" out
 * of a label-only "EFFECTIVE DATE" detection that carries no value at all.
 */
function inlineValue(normalized: string, anchor: string): string | null {
  const at = normalized.indexOf(anchor)
  if (at === -1) return null
  const rest = normalized.slice(at + anchor.length)
  if (/^[A-Z]/.test(rest)) return null
  return rest.replace(/^[:.#]+/, '') || null
}

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
 */
function adjacentValue(detections: readonly Detection[], label: Detection): Detection | null {
  const others = detections.filter((d) => d !== label)

  const right = others
    .filter((d) => overlapsY(label.box, d.box) && gapRight(label.box, d.box) >= 0
      && gapRight(label.box, d.box) <= MAX_GAP)
    .sort((a, b) => gapRight(label.box, a.box) - gapRight(label.box, b.box))
  if (right[0]) return right[0]

  const below = others
    .filter((d) => overlapsX(label.box, d.box) && gapBelow(label.box, d.box) >= 0
      && gapBelow(label.box, d.box) <= MAX_GAP)
    .sort((a, b) => gapBelow(label.box, a.box) - gapBelow(label.box, b.box))
  return below[0] ?? null
}

type Found = { readonly raw: string; readonly box: Box }

/** The first anchor with a value: inline on its own detection, or the nearest neighbour. */
function findLabelled(
  detections: readonly Detection[],
  anchors: readonly string[],
): Found | null {
  for (const anchor of anchors) {
    const wanted = normalizeText(anchor)
    for (const detection of detections) {
      const normalized = normalizeText(detection.text)
      if (!normalized.includes(wanted)) continue

      const inline = inlineValue(normalized, wanted)
      if (inline) return { raw: inline, box: detection.box }

      const neighbour = adjacentValue(detections, detection)
      if (neighbour) return { raw: neighbour.text.replace(/\s+/g, ' ').trim(), box: neighbour.box }
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
    const found = findLabelled(detections, anchors)
    if (!found) continue

    const raw = DATE_FIELDS.has(field) ? isoFrom(found.raw) : found.raw
    if (!raw) continue

    const key = INSTANCED.has(field) ? reqKey(field as FieldId, 0) : field
    out.push({
      key,
      raw,
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
registerStrategy('proof_of_residency', extractLabelled)
