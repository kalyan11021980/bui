import type { Evidence } from './extract/types'

/** At or above this a row goes quiet. Below it, the "hard to read" line shows. */
export const QUIET_THRESHOLD = 0.8

/**
 * A schema-valid read is a confident read: the model read the document into
 * markdown and the value parsed against its catalog schema. The one residual
 * risk the schema cannot see is a confusable identifier — `I1234568` read as
 * `11234568` — and that alone drops a row below the quiet threshold.
 */
const BASE = 0.9
const GLYPH_PENALTY = 0.2

export function scoreEvidence(evidence: Evidence): number {
  // A value its own schema rejects is not a low-confidence value; upstream
  // drops it. Scoring zero here is the belt to that braces.
  if (!evidence.schemaParsed) return 0

  let score = BASE
  // Asymmetric on purpose: an unambiguous identifier has earned nothing, it
  // has merely avoided the one failure we cannot otherwise see.
  if (evidence.glyphAmbiguous === true) score -= GLYPH_PENALTY

  // toFixed(3) isn't cosmetic: floats like 0.9 - 0.2 carry representation
  // error that would otherwise leak straight into a displayed score.
  return Math.min(1, Math.max(0, Number(score.toFixed(3))))
}