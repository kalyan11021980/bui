import type { RequirementKey } from '@/domain/requirements/key'
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
}
