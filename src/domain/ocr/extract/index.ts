import { CATALOG } from '@/domain/catalog'
import { parseReqKey } from '@/domain/requirements/key'
import type { Candidate } from './types'

export type { Candidate, Evidence } from './types'
export { glyphAmbiguity, NO_EVIDENCE } from './types'

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