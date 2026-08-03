import type { Candidate, Evidence } from './extract/types'

/** At or above this a row goes quiet. Below it, the crop comes out. */
export const QUIET_THRESHOLD = 0.8

/**
 * Weights over observable signals, not the model's self-belief. Two
 * invariants constrain these numbers, both pinned in confidence.test.ts:
 * a checksum alone (no label — that combination never occurs in real
 * extractor output) must reach quiet even with a glyph-ambiguous read, and a
 * cross-pass disagreement must keep a value noisy no matter what else is
 * true, checksum included.
 */
const WEIGHT = {
  labelAnchored: 0.25,
  checksumValid: 0.75,
  crossPassAgreed: 0.6,
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

  // toFixed(3) isn't cosmetic: 0.3 + 0.6 is 0.8999999999999999 in float, and
  // that noise would otherwise leak straight into a displayed score.
  return Math.min(1, Math.max(0, Number(score.toFixed(3))))
}

const WORD_CHAR = /[A-Z0-9]/

/**
 * True where `needle` occurs in `haystack` as a whole token — not merely a
 * substring. Grounded text has its whitespace stripped and cannot support
 * this (`normalizeText` in `./grounding` exists for that reason and is
 * deliberately not used here); `plainText`, the second OCR pass this
 * compares against, keeps its natural spacing and punctuation, so the
 * characters immediately before and after a match can be checked.
 *
 * Without this, a one-character value (a sex marker `M`) or a two-character
 * one (a state code `CA`) matches almost any haystack that merely contains
 * those letters as part of a longer word (`MARIA`, `CALIFORNIA`) — agreement
 * that has not been earned. A length cutoff would dodge that by refusing to
 * ever check short values at all, silently discarding the ones that *do*
 * appear as their own token.
 */
function isWholeWordMatch(haystack: string, needle: string): boolean {
  if (needle === '') return false
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = haystack[at - 1]
    const after = haystack[at + needle.length]
    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) return true
    from = at + 1
  }
}

/**
 * Neither prompt mode dominates — measured 2026-08-02, grounded won 34/36
 * overall and lost 7/9 to 8/9 on one card. Disagreement between them is the
 * cheapest signal we have for a misread identifier.
 *
 * Compares `asRead` when a candidate has one, not `raw`: dates are converted
 * to ISO before they ever reach here, and the plain pass only ever saw the
 * printed `MM/DD/YYYY` — comparing the ISO form manufactures a disagreement
 * out of a formatting choice, not a misread.
 */
export function withCrossPass(
  candidates: readonly Candidate[],
  plainText: string,
): readonly Candidate[] {
  if (plainText.trim() === '') return candidates
  const haystack = plainText.toUpperCase()

  return candidates.map((candidate) => {
    const needle = (candidate.asRead ?? candidate.raw).toUpperCase()
    return {
      ...candidate,
      evidence: {
        ...candidate.evidence,
        crossPassAgreed: isWholeWordMatch(haystack, needle),
      },
    }
  })
}
