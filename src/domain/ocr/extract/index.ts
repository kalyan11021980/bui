import { CATALOG } from '@/domain/catalog'
import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'
import type { DocType } from '@/domain/field-id'
import type { Detection } from '../grounding'
import type { Candidate, ExtractStrategy } from './types'

export type { Candidate, Evidence, ExtractStrategy } from './types'
export { NO_EVIDENCE } from './types'

const strategies = new Map<DocType, ExtractStrategy>()

export function registerStrategy(docType: DocType, strategy: ExtractStrategy): void {
  strategies.set(docType, strategy)
}

/**
 * What a document can prove is the catalog's call, and a strategy is never
 * told which document it is reading. A card carries an ID number, but until
 * `dl_number` lists `state_id` in `derivableFrom`, reading one off a state ID
 * is out of contract.
 */
export function derivable(docType: DocType, key: RequirementKey): boolean {
  try {
    return CATALOG.get(parseReqKey(key).fieldId)?.derivableFrom?.includes(docType) ?? false
  } catch {
    return false
  }
}

/** No strategy is not an error: the fields get asked for as they are today. */
export function extractFor(
  docType: DocType,
  detections: readonly Detection[],
  text: string,
): readonly Candidate[] {
  const found = strategies.get(docType)?.(detections, text) ?? []
  return found.filter((c) => derivable(docType, c.key))
}

/**
 * A value its own field rejects is dropped, not scored low. A malformed read
 * is not a read we are slightly unsure about.
 */
export function parseCandidates(
  candidates: readonly Candidate[],
): readonly Candidate[] {
  const kept: Candidate[] = []

  for (const candidate of candidates) {
    let bareId
    try {
      bareId = parseReqKey(candidate.key).fieldId
    } catch {
      continue
    }

    const def = CATALOG.get(bareId)
    if (!def || !def.validation.safeParse(candidate.raw).success) continue

    kept.push({ ...candidate, evidence: { ...candidate.evidence, schemaParsed: true } })
  }

  return kept
}
