import { isPlausibleBox } from '../geometry'
import { normalizeText, type Box, type Detection } from '../grounding'
import { registerStrategy } from './index'
import { AAMVA_ANCHORS, LABEL_CODES, LABEL_WORDS } from './synonyms'
import {
  NO_EVIDENCE, type Candidate, type Evidence, type ExtractStrategy,
} from './types'

/** A read value, before it is told which field it answers. */
type Found = { readonly raw: string; readonly box: Box; readonly evidence: Evidence }

const US_DATE = /(\d{2})[/-](\d{2})[/-](\d{4})/
const CITY_STATE_ZIP = /^(.*?)[,.\s]*([A-Z]{2})[,.\s]*(\d{5}(?:-\d{4})?)$/
const NAME_VALUE = /^[A-Z][A-Z' .,-]+$/
const NUMBER_VALUE = /^[A-Z0-9][A-Z0-9-]{3,}$/

/** Codes and words survive normalisation; everything else is scenery. */
function key(text: string): string {
  return normalizeText(text).replace(/[^A-Z0-9#]/g, '')
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toUpperCase()
}

/** Cards print MM/DD/YYYY; every field schema wants ISO. */
function toIsoDate(raw: string): string | null {
  const match = US_DATE.exec(raw)
  if (!match) return null
  const [, month, day, year] = match
  return `${year}-${month}-${day}`
}

export function splitAddressBlock(raw: string): {
  line1?: string; city?: string; state?: string; zip?: string
} {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return {}

  const match = CITY_STATE_ZIP.exec(clean(lines[lines.length - 1] ?? ''))
  const [, city, state, zip] = match ?? []
  if (!city || !state || !zip) return {}

  return { line1: lines.slice(0, -1).join(' '), city, state, zip }
}

/** A code followed by more digits is a longer number, not that code. */
function codeAt(text: string, code: string): boolean {
  if (!text.startsWith(code)) return false
  if (!/^\d+$/.test(code)) return true
  return !/\d/.test(text.charAt(code.length))
}

/** A detection that opens with a printed label is never the value beside it. */
function isLabel(text: string): boolean {
  return LABEL_CODES.some((c) => codeAt(text, c))
    || LABEL_WORDS.some((w) => text.startsWith(w))
}

function anchorAt(text: string, anchor: string): boolean {
  if (!text.startsWith(anchor)) return false
  return !LABEL_CODES.some((c) => c.length > anchor.length && text.startsWith(c))
}

/** Anchoring finds the detection; the anchor text then has to come off it. */
function stripAnchors(text: string, anchors: readonly string[]): string {
  let rest = text
  for (let i = 0; i < anchors.length; i += 1) {
    const longest = anchors
      .filter((a) => rest.startsWith(a))
      .sort((a, b) => b.length - a.length)[0]
    if (longest === undefined) break
    rest = rest.slice(longest.length)
  }
  return rest
}

type Hit = { readonly detection: Detection; readonly remainder: string }

/** Every detection an anchor could mean, most specific anchor first. */
function hits(
  detections: readonly Detection[],
  anchors: readonly string[],
): Hit[] {
  const out: Hit[] = []
  for (const anchor of anchors) {
    for (const detection of detections) {
      const text = key(detection.text)
      if (!anchorAt(text, anchor)) continue
      out.push({ detection, remainder: stripAnchors(text, anchors) })
    }
  }
  return out
}

const centre = (box: Box): [number, number] =>
  [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]

const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean =>
  Math.min(a1, b1) > Math.max(a0, b0)

function distance(a: Box, b: Box): number {
  const [ax, ay] = centre(a)
  const [bx, by] = centre(b)
  return Math.hypot(ax - bx, ay - by)
}

const isRightOf = (anchor: Box, box: Box): boolean =>
  centre(box)[0] > centre(anchor)[0] && overlaps(anchor[1], anchor[3], box[1], box[3])

const isBelow = (anchor: Box, box: Box): boolean =>
  centre(box)[1] > centre(anchor)[1] && overlaps(anchor[0], anchor[2], box[0], box[2])

/**
 * A value sits against its label. Without a bound, a lone `1` in the restriction
 * box on the Maryland card claims the BIRTH DATE label two rows down as a
 * surname. Coordinates are 0-1000, so this is 6% of the card.
 */
const MAX_GAP = 60

const isAdjacent = (anchor: Box, box: Box): boolean =>
  box[0] - anchor[2] <= MAX_GAP && box[1] - anchor[3] <= MAX_GAP

/**
 * Most states print the label in its own detection and the value beside or
 * under it. Same row first: a label's own column continues downward, so a
 * value to the right beats a neighbouring field's label further down.
 */
function nearestValue(
  detections: readonly Detection[],
  anchor: Detection,
  accepts: (d: Detection) => boolean,
): Detection | null {
  const usable = detections.filter(
    (d) => d !== anchor && !isLabel(key(d.text))
      && isAdjacent(anchor.box, d.box) && accepts(d),
  )
  const byDistance = (a: Detection, b: Detection) =>
    distance(anchor.box, a.box) - distance(anchor.box, b.box)

  const right = usable.filter((d) => isRightOf(anchor.box, d.box)).sort(byDistance)
  if (right[0]) return right[0]
  return usable.filter((d) => isBelow(anchor.box, d.box)).sort(byDistance)[0] ?? null
}

function isNumber(text: string): boolean {
  return NUMBER_VALUE.test(text) && /\d/.test(text) && !LABEL_WORDS.includes(text)
}

function isName(text: string): boolean {
  return NAME_VALUE.test(text) && !LABEL_WORDS.includes(text)
}

const hasDate = (d: Detection): boolean => US_DATE.test(normalizeText(d.text))

function evidenceFor(box: Box, labelAnchored: boolean): Evidence {
  // No checksum on a card: `null` says the signal does not apply, not that it
  // failed.
  return { ...NO_EVIDENCE, labelAnchored, boxPlausible: isPlausibleBox(box) }
}

function union(boxes: readonly Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ]
}

/** A number or name printed on the same detection as its code, or beside it. */
function simpleField(
  detections: readonly Detection[],
  hit: Hit,
  accepts: (text: string) => boolean,
): Found | null {
  if (hit.remainder !== '') {
    // Text after the code that is not a value means we matched the wrong
    // detection — not that the field is malformed.
    if (!accepts(hit.remainder) || hasDate(hit.detection)) return null
    const box = hit.detection.box
    return { raw: hit.remainder, box, evidence: evidenceFor(box, true) }
  }

  const found = nearestValue(detections, hit.detection, (d) => accepts(key(d.text)))
  if (!found) return null
  const raw = accepts(clean(found.text)) ? clean(found.text) : key(found.text)
  return { raw, box: found.box, evidence: evidenceFor(found.box, true) }
}

function dateField(detections: readonly Detection[], hit: Hit): Found | null {
  const inline = toIsoDate(hit.detection.text)
  if (inline) {
    const box = hit.detection.box
    return { raw: inline, box, evidence: evidenceFor(box, true) }
  }
  if (hit.remainder !== '') return null

  const found = nearestValue(detections, hit.detection, hasDate)
  const raw = found && toIsoDate(found.text)
  if (!found || !raw) return null
  return { raw, box: found.box, evidence: evidenceFor(found.box, true) }
}

/** `1,2 Name`: surname on the first line, given names on the second. */
function nameBlock(detections: readonly Detection[], hit: Hit): Candidate[] {
  const stacked = detections
    .filter((d) => d !== hit.detection && !isLabel(key(d.text)))
    .filter((d) => isBelow(hit.detection.box, d.box) && isName(clean(d.text)))
    .sort((a, b) => a.box[1] - b.box[1])
    .map((d) => ({ raw: clean(d.text), box: d.box }))

  const lines = isName(hit.remainder)
    ? [{ raw: hit.remainder, box: hit.detection.box }, ...stacked]
    : stacked

  return lines.slice(0, 2).map((line, index) => ({
    key: index === 0 ? 'last_name' : 'first_name',
    raw: line.raw,
    box: line.box,
    evidence: evidenceFor(line.box, true),
  }))
}

function addressParts(
  lines: readonly { raw: string; box: Box }[],
  labelAnchored: boolean,
): Candidate[] {
  const parts = splitAddressBlock(lines.map((l) => l.raw).join('\n'))
  const street = lines.slice(0, -1).map((l) => l.box)
  const tail = lines[lines.length - 1]?.box
  if (!tail || street.length === 0) return []

  const line1Box = union(street)
  const out: Candidate[] = []
  for (const [field, raw, box] of [
    ['addr_line1', parts.line1, line1Box], ['addr_city', parts.city, tail],
    ['addr_state', parts.state, tail], ['addr_zip', parts.zip, tail],
  ] as const) {
    if (raw && box) out.push({ key: field, raw, box, evidence: evidenceFor(box, labelAnchored) })
  }
  return out
}

const isCityStateZip = (d: Detection): boolean =>
  CITY_STATE_ZIP.test(clean(d.text)) && !isLabel(key(d.text))

/** Walks down from the address code until the city/state/ZIP line turns up. */
function anchoredAddress(
  detections: readonly Detection[],
  hit: Hit,
): Candidate[] {
  const lines: { raw: string; box: Box }[] = []
  if (hit.remainder !== '') lines.push({ raw: hit.remainder, box: hit.detection.box })

  const below = detections
    .filter((d) => d !== hit.detection && isBelow(hit.detection.box, d.box))
    .sort((a, b) => a.box[1] - b.box[1])

  for (const d of below.slice(0, 3)) {
    lines.push({ raw: clean(d.text), box: d.box })
    if (isCityStateZip(d)) return addressParts(lines, true)
  }
  return []
}

/**
 * Massachusetts, Oregon and California print the address with no code beside
 * it. `CITY, ST 99999` is distinctive enough to anchor on itself — but that is
 * a shape, not a label, so it does not claim `labelAnchored`.
 */
function unlabelledAddress(detections: readonly Detection[]): Candidate[] {
  for (const tail of detections.filter(isCityStateZip)) {
    const above = detections
      .filter((d) => d !== tail && !isLabel(key(d.text)) && !isCityStateZip(d))
      .filter((d) => isBelow(d.box, tail.box))
      .sort((a, b) => b.box[1] - a.box[1])[0]
    if (!above) continue
    return addressParts(
      [{ raw: clean(above.text), box: above.box }, { raw: clean(tail.text), box: tail.box }],
      false,
    )
  }
  return []
}

function addressBlock(detections: readonly Detection[]): Candidate[] {
  for (const hit of hits(detections, AAMVA_ANCHORS.address_block ?? [])) {
    const found = anchoredAddress(detections, hit)
    if (found.length > 0) return found
  }
  return unlabelledAddress(detections)
}

/**
 * Reads a driver's licence or state ID by the codes printed on it.
 *
 * Whether the document type is allowed to prove a field is the catalog's call,
 * enforced in `extractFor` — this strategy is not told which document it is
 * looking at.
 */
export const extractAamva: ExtractStrategy = (detections) => {
  const out: Candidate[] = []
  const push = (candidate: Candidate | null): boolean => {
    if (!candidate || out.some((c) => c.key === candidate.key)) return false
    out.push(candidate)
    return true
  }

  for (const [field, anchors] of Object.entries(AAMVA_ANCHORS)) {
    if (field === 'address_block') continue

    for (const hit of hits(detections, anchors)) {
      if (field === 'name_block') {
        const found = nameBlock(detections, hit)
        if (found.length > 0) { found.forEach(push); break }
        continue
      }

      const found = field === 'dob' || field === 'dl_expiry'
        ? dateField(detections, hit)
        : simpleField(detections, hit, field === 'dl_number' ? isNumber : isName)
      if (found && push({ ...found, key: field })) break
    }
  }

  addressBlock(detections).forEach(push)
  return out
}


registerStrategy('drivers_license', extractAamva)
registerStrategy('state_id', extractAamva)
