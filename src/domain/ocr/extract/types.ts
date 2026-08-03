import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'
import type { Box, Detection } from '../grounding'

/**
 * What we observed about how a value was obtained. `null` means the signal
 * does not apply to this document — a card has no checksum — which is not the
 * same as failing it.
 */
export type Evidence = {
  readonly schemaParsed: boolean
  readonly labelAnchored: boolean
  readonly checksumValid: boolean | null
  readonly crossPassAgreed: boolean | null
  readonly boxPlausible: boolean | null
  /** Null where the field is not identifier-shaped and the confusion cannot arise. */
  readonly glyphAmbiguous: boolean | null
}

export type Candidate = {
  readonly key: RequirementKey
  readonly raw: string
  readonly box?: Box
  readonly evidence: Evidence
}

export type ExtractStrategy = (
  detections: readonly Detection[],
  text: string,
) => readonly Candidate[]

export const NO_EVIDENCE: Evidence = {
  schemaParsed: false, labelAnchored: false,
  checksumValid: null, crossPassAgreed: null, boxPlausible: null,
  glyphAmbiguous: null,
}

/**
 * Fields whose value is an identifier, where one glyph read for another is a
 * different number rather than a different spelling.
 */
const IDENTIFIER_FIELDS: ReadonlySet<string> = new Set([
  'dl_number', 'id_number', 'passport_number', 'license_number',
])

/** Mutually confusable in print: the CA card's `I1234568` came back `11234568`. */
const CONFUSABLE = /[0O1I5S8B]/

/**
 * Subtract-only, and never a filter: an ambiguous value is still emitted. It
 * is a value we are less sure of, not a malformed one.
 */
export function glyphAmbiguity(
  key: RequirementKey,
  raw: string,
): boolean | null {
  let fieldId
  try {
    fieldId = parseReqKey(key).fieldId
  } catch {
    return null
  }
  if (!IDENTIFIER_FIELDS.has(fieldId)) return null
  return CONFUSABLE.test(raw.toUpperCase())
}
