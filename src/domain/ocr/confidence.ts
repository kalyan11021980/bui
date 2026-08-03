import { normalizeText } from './grounding'
import type { Candidate, Evidence } from './extract/types'

/** At or above this a row goes quiet. Below it, the crop comes out. */
export const QUIET_THRESHOLD = 0.8

/**
 * Weights over observable signals. Nothing here is the model's opinion of
 * itself: the failure that matters — a capital I read as a digit 1 — is a
 * high-probability substitution, so logprobs would rate it certain.
 *
 * checksumValid is 0.5, not the 0.45 first drafted: schemaParsed +
 * labelAnchored + checksumValid - glyphAmbiguous landed exactly on
 * QUIET_THRESHOLD at 0.45, which is the one case (an MRZ number, glyph-
 * ambiguous but checksum-proven) that most needs to stay quiet. Sitting
 * precisely on the boundary means the next unrelated weight change flips it
 * with no warning; 0.5 buys that case real margin (0.85) without changing
 * any ordering the other tests rely on.
 */
const WEIGHT = {
  labelAnchored: 0.25,
  checksumValid: 0.5,
  crossPassAgreed: 0.25,
  boxPlausible: 0.05,
  /**
   * Only ever subtracts. An identifier holding 0/O, 1/I, 5/S or 8/B is the
   * case that produced `11234568` from `I1234568` — plausible, wrong, and
   * invisible to every other signal.
   */
  glyphAmbiguous: 0.2,
} as const

const BASE = 0.3

export function scoreEvidence(evidence: Evidence): number {
  // A value its own schema rejects is not a low-confidence value; upstream
  // drops it. Scoring zero here is the belt to that braces.
  if (!evidence.schemaParsed) return 0

  let score = BASE
  if (evidence.labelAnchored) score += WEIGHT.labelAnchored

  for (const signal of ['checksumValid', 'crossPassAgreed', 'boxPlausible'] as const) {
    const value = evidence[signal]
    // null is "does not apply", which must not read as failure.
    if (value === true) score += WEIGHT[signal]
    else if (value === false) score -= WEIGHT[signal]
  }

  // Asymmetric on purpose: an unambiguous identifier has earned nothing, it
  // has merely avoided the one failure we cannot otherwise see.
  if (evidence.glyphAmbiguous === true) score -= WEIGHT.glyphAmbiguous

  return Math.min(1, Math.max(0, Number(score.toFixed(3))))
}

/** Below this, a substring match is coincidence rather than corroboration. */
const MIN_CROSSPASS_LENGTH = 2

/**
 * Neither prompt mode dominates — measured 2026-08-02, grounded won 34/36
 * overall and lost 7/9 to 8/9 on one card. Disagreement between them is the
 * cheapest signal we have for a misread identifier.
 */
export function withCrossPass(
  candidates: readonly Candidate[],
  plainText: string,
): readonly Candidate[] {
  if (plainText.trim() === '') return candidates
  const haystack = normalizeText(plainText)

  return candidates.map((candidate) => {
    const needle = normalizeText(candidate.raw)
    // `includes` matches by substring: a sex marker 'M' or a licence class
    // 'D' is a substring of almost any haystack, which is agreement it has
    // not earned. Leave the signal as-is (null, "does not apply") rather
    // than credit a match that proves nothing.
    if (needle.length < MIN_CROSSPASS_LENGTH) return candidate

    return {
      ...candidate,
      evidence: { ...candidate.evidence, crossPassAgreed: haystack.includes(needle) },
    }
  })
}
