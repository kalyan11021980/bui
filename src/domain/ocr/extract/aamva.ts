import { isRealCalendarDate } from '@/domain/calendar'
import { isPlausibleBox } from '../geometry'
import { normalizeText, type Box, type Detection } from '../grounding'
import { registerStrategy } from './index'
import { AAMVA_ANCHORS, isLabel, LABEL_CODES, LABEL_WORDS } from './synonyms'
import {
  glyphAmbiguity, NO_EVIDENCE,
  type Candidate, type Evidence, type ExtractStrategy,
} from './types'

/** A read value, before it is told which field it answers. */
type Found = { readonly raw: string; readonly box: Box; readonly evidence: Evidence }

const US_DATE = /(\d{2})[/-](\d{2})[/-](\d{4})/
const CITY_STATE_ZIP = /^(.*?)[,.\s]*([A-Z]{2})[,.\s]*(\d{5}(?:-\d{4})?)$/
const NAME_VALUE = /^[A-Z][A-Z' .,-]+$/
const NUMBER_VALUE = /^[A-Z0-9][A-Z0-9-]{3,}$/
const HOUSE_NUMBER = /^\d/

/**
 * Without this, any two letters before a ZIP become a state: `ANYTOWN 95818`
 * splits into city `ANYTO`, state `WN`, and `addr_state` validation — two
 * characters — accepts it.
 */
const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY', 'AS', 'GU', 'MP', 'PR', 'VI',
])

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
  const iso = `${year}-${month}-${day}`
  return isRealCalendarDate(iso) ? iso : null
}

type Tail = { readonly city: string; readonly state: string; readonly zip: string }

/** The last line of an address, or null if those two letters are not a state. */
function cityStateZip(line: string): Tail | null {
  const [, city, state, zip] = CITY_STATE_ZIP.exec(clean(line)) ?? []
  if (!city || !state || !zip || !US_STATES.has(state)) return null
  return { city, state, zip }
}

export function splitAddressBlock(raw: string): {
  line1?: string; city?: string; state?: string; zip?: string
} {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return {}

  const tail = cityStateZip(lines[lines.length - 1] ?? '')
  if (!tail) return {}

  return { line1: lines.slice(0, -1).join(' '), ...tail }
}

/**
 * Anchors a card prints flush against a letter value, with no separator left
 * for us to see. Everything else that runs straight into a letter is a fragment
 * of a longer word, not a code.
 */
const MERGES_INTO_LETTERS = new Set(['LN', 'FN'])
const ORDINAL = /^(ST|ND|RD|TH)/

/**
 * Matching on `startsWith` alone reads a city as a licence number: drop the
 * `4d NUMBER` label from the Massachusetts card — the same label loss this
 * corpus already shows — and `NO` claims `NORTHQUINCY,MA02171-1748`, shipping
 * `RTHQUINCYMA021711748` with every evidence signal green.
 */
function anchorAt(text: string, anchor: string): boolean {
  if (!text.startsWith(anchor)) return false
  if (LABEL_CODES.some((c) => c.length > anchor.length && text.startsWith(c))) return false

  const rest = text.slice(anchor.length)
  // `1ST FLOOR` is an ordinal, not field 1.
  if (/^\d+$/.test(anchor) && ORDINAL.test(rest)) return false
  if (/^[A-Z#]+$/.test(anchor) && /^[A-Z]/.test(rest)) return MERGES_INTO_LETTERS.has(anchor)
  return true
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
 * surname. Coordinates are 0-1000: the widest genuine gap in the corpus is 34,
 * that Maryland miss is 118.
 */
const MAX_GAP = 60

/** Bounded on all four sides: a value is never far back up or left of its code. */
const isAdjacent = (anchor: Box, box: Box): boolean =>
  box[0] - anchor[2] <= MAX_GAP && box[1] - anchor[3] <= MAX_GAP
  && anchor[0] - box[0] <= MAX_GAP && anchor[1] - box[1] <= MAX_GAP

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

const DATE_FIELDS = new Set(['dob', 'dl_expiry'])
const NUMBER_FIELDS = new Set(['dl_number', 'id_number'])

function isNumber(text: string): boolean {
  return NUMBER_VALUE.test(text) && /\d/.test(text) && !LABEL_WORDS.includes(text)
}

function isName(text: string): boolean {
  return NAME_VALUE.test(text) && !LABEL_WORDS.includes(text)
}

const hasDate = (d: Detection): boolean => US_DATE.test(normalizeText(d.text))

/**
 * AAMVA prints given names on one line: FIRST MIDDLE. We have a field for the
 * first of them and none for the rest, so the rest is dropped rather than
 * filed under `first_name`. Where OCR returns the line with no spaces
 * (`RICHARDBENJAMIN`) there is nothing to split on and the whole line stands —
 * wrong, and recorded as wrong.
 */
const firstGivenName = (value: string): string => value.split(/[\s,]+/)[0] ?? value

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

/**
 * The remainder is computed on the key, which has no spaces. Recover them from
 * the original text so `2 OREGON SAMPLE, SR` can still be split at the space.
 */
function inlineValue(text: string, remainder: string): string {
  const cleaned = clean(text)
  const skip = key(text).length - remainder.length
  let seen = 0
  for (let i = 0; i < cleaned.length; i += 1) {
    if (seen === skip) return cleaned.slice(i).replace(/^[^A-Z0-9]+/, '').trim()
    if (/[A-Z0-9#]/.test(cleaned.charAt(i))) seen += 1
  }
  return remainder
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
    const spaced = inlineValue(hit.detection.text, hit.remainder)
    const raw = accepts(spaced) ? spaced : hit.remainder
    return { raw, box, evidence: evidenceFor(box, true) }
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
    raw: index === 0 ? line.raw : firstGivenName(line.raw),
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
  cityStateZip(d.text) !== null && !isLabel(key(d.text))

/** Walks down from the address code until the city/state/ZIP line turns up. */
function anchoredAddress(
  detections: readonly Detection[],
  hit: Hit,
): Candidate[] {
  const lines: { raw: string; box: Box }[] = []
  if (hit.remainder !== '') lines.push({ raw: hit.remainder, box: hit.detection.box })

  const below = detections
    .filter((d) => d !== hit.detection && isBelow(hit.detection.box, d.box) && !hasDate(d))
    .sort((a, b) => a.box[1] - b.box[1])

  for (const d of below.slice(0, 3)) {
    lines.push({ raw: clean(d.text), box: d.box })
    if (isCityStateZip(d)) return addressParts(lines, true)
  }
  return []
}

/**
 * A street can run to more than one line, and the house number opens the first
 * of them. Taking a single line above the city gets Massachusetts' `APT. 1` and
 * silently drops `123 NORTH MAIN STREET` — a delivery address that is wrong
 * while looking complete.
 */
function streetAbove(
  detections: readonly Detection[],
  tail: Detection,
): Detection[] {
  const lines: Detection[] = []
  let from = tail.box

  for (let i = 0; i < 3; i += 1) {
    const above = detections
      .filter((d) => d !== tail && !lines.includes(d))
      // A date opens with a digit, which is otherwise how a street opens.
      .filter((d) => !isLabel(key(d.text)) && !isCityStateZip(d) && !hasDate(d))
      .filter((d) => isBelow(d.box, from) && from[1] - d.box[3] <= MAX_GAP)
      .sort((a, b) => b.box[1] - a.box[1])[0]
    if (!above) break

    lines.unshift(above)
    from = above.box
    if (HOUSE_NUMBER.test(key(above.text))) return lines
  }
  // No house number found: keep the one line we are sure about rather than
  // sweeping the name off the card above it.
  return lines.slice(-1)
}

/**
 * Massachusetts, Oregon and California lost their address code to OCR — the
 * cards print one. `CITY, ST 99999` is distinctive enough to anchor on itself,
 * but that is a shape, not a label, so it does not claim `labelAnchored`.
 */
function unlabelledAddress(detections: readonly Detection[]): Candidate[] {
  for (const tail of detections.filter(isCityStateZip)) {
    const street = streetAbove(detections, tail)
    if (street.length === 0) continue
    return addressParts(
      [...street, tail].map((d) => ({ raw: clean(d.text), box: d.box })),
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
    // Set here rather than per branch, so no field can be given the signal by
    // accident or left without it by omission.
    out.push({
      ...candidate,
      evidence: {
        ...candidate.evidence,
        glyphAmbiguous: glyphAmbiguity(candidate.key, candidate.raw),
      },
    })
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

      const found = DATE_FIELDS.has(field)
        ? dateField(detections, hit)
        : simpleField(detections, hit, NUMBER_FIELDS.has(field) ? isNumber : isName)
      if (!found) continue

      const raw = field === 'first_name' ? firstGivenName(found.raw) : found.raw
      if (push({ ...found, raw, key: field })) break
    }
  }

  addressBlock(detections).forEach(push)
  return out
}

registerStrategy('drivers_license', extractAamva)
registerStrategy('state_id', extractAamva)
