export type VoiceViolation =
  | 'numeral' | 'percentage' | 'statute' | 'legal_claim' | 'length'

export type VoiceLintResult =
  | { ok: true }
  | { ok: false; violation: VoiceViolation }

const MAX_LENGTH = 240

/** Any Unicode decimal digit — a numeral in another script is still a numeral. */
const NUMERAL = /\p{Nd}/u
const PERCENTAGE = /%|\bpercent\b|\bper cent\b/i
const STATUTE = /§|\bU\.?S\.?C\.?\b|\bC\.?F\.?R\.?\b|\bIRC\b|\bTitle\s+\p{Nd}/iu

/**
 * Phrasings that assert an obligation. Not a general classifier — a closed
 * list is auditable and a model is not.
 */
const LEGAL_CLAIM = [
  /\brequired by law\b/i,
  /\byou must\b/i,
  /\byou are (?:liable|obligated|responsible under)\b/i,
  /\bpenalt(?:y|ies)\b/i,
  /\bunder oath\b/i,
  /\bwe are required to\b/i,
]

export function lintVoice(text: string): VoiceLintResult {
  if (text.length > MAX_LENGTH) return { ok: false, violation: 'length' }
  if (STATUTE.test(text)) return { ok: false, violation: 'statute' }
  if (PERCENTAGE.test(text)) return { ok: false, violation: 'percentage' }
  if (NUMERAL.test(text)) return { ok: false, violation: 'numeral' }
  for (const pattern of LEGAL_CLAIM) {
    if (pattern.test(text)) return { ok: false, violation: 'legal_claim' }
  }
  return { ok: true }
}
