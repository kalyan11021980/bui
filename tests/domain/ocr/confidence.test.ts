import { describe, expect, it } from 'vitest'
import { QUIET_THRESHOLD, scoreEvidence, withCrossPass } from '@/domain/ocr/confidence'
import { NO_EVIDENCE } from '@/domain/ocr/extract/types'
import type { Candidate, Evidence } from '@/domain/ocr/extract/types'

const evidence = (patch: Partial<Evidence>): Evidence => ({ ...NO_EVIDENCE, ...patch })

describe('scoreEvidence', () => {
  it('stays within bounds for every combination', () => {
    const flags = [true, false, null] as const
    for (const checksumValid of flags) {
      for (const crossPassAgreed of flags) {
        for (const boxPlausible of flags) {
          for (const labelAnchored of [true, false]) {
            const score = scoreEvidence(evidence({
              schemaParsed: true, labelAnchored,
              checksumValid, crossPassAgreed, boxPlausible,
            }))
            expect(score).toBeGreaterThanOrEqual(0)
            expect(score).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('rates a validated checksum above a bare label anchor', () => {
    const checksummed = scoreEvidence(evidence({ schemaParsed: true, checksumValid: true }))
    const anchored = scoreEvidence(evidence({ schemaParsed: true, labelAnchored: true }))
    expect(checksummed).toBeGreaterThan(anchored)
  })

  it('drops below the quiet threshold when the two passes disagree', () => {
    // The CA specimen: grounded read 11234568, plain read I1234568. A value
    // the two passes disagree on is exactly the one that must not go quiet.
    const disagreed = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, crossPassAgreed: false,
    }))
    expect(disagreed).toBeLessThan(QUIET_THRESHOLD)
  })

  it('rates agreement above disagreement, all else equal', () => {
    const agreed = scoreEvidence(evidence({ schemaParsed: true, crossPassAgreed: true }))
    const disagreed = scoreEvidence(evidence({ schemaParsed: true, crossPassAgreed: false }))
    expect(agreed).toBeGreaterThan(disagreed)
  })

  it('scores zero when the value never parsed', () => {
    expect(scoreEvidence(evidence({ schemaParsed: false, checksumValid: true }))).toBe(0)
  })

  it('scores zero even when every other signal is green', () => {
    // A schema failure is not "low confidence" — it is a value upstream
    // should have dropped. Every other flag true must not claw back above 0.
    const score = scoreEvidence(evidence({
      schemaParsed: false, labelAnchored: true, checksumValid: true,
      crossPassAgreed: true, boxPlausible: true, glyphAmbiguous: false,
    }))
    expect(score).toBe(0)
  })

  it('drops an ambiguous identifier below an unambiguous one', () => {
    // `I1234568` read as `11234568`: label anchored, box fine, schema happy,
    // and wrong. The glyph signal is the only thing that can see it.
    const ambiguous = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, glyphAmbiguous: true,
    }))
    const clean = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, glyphAmbiguous: false,
    }))
    expect(ambiguous).toBeLessThan(clean)
  })

  it('gives an unambiguous identifier no bonus over a field that cannot be ambiguous', () => {
    // Asymmetric by design: avoiding a failure is not an achievement.
    const clean = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, glyphAmbiguous: false,
    }))
    const notApplicable = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, glyphAmbiguous: null,
    }))
    expect(clean).toBe(notApplicable)
  })

  it('keeps a checksum-validated identifier quiet despite ambiguous glyphs', () => {
    // An MRZ number proves itself arithmetically, so glyph shape stops
    // mattering. Losing that would make every passport noisy for no reason.
    const score = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true,
      checksumValid: true, glyphAmbiguous: true,
    }))
    expect(score).toBeGreaterThanOrEqual(QUIET_THRESHOLD)
  })

  it('does not punish a signal that does not apply', () => {
    const noChecksum = scoreEvidence(evidence({ schemaParsed: true, labelAnchored: true }))
    const failedChecksum = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, checksumValid: false,
    }))
    expect(noChecksum).toBeGreaterThan(failedChecksum)
  })

  it('treats a null signal identically across all three nullable fields', () => {
    // The three-signal loop above proves ordering; this proves the null
    // baseline is the same fixed point regardless of which signal is unset,
    // not a fluke of the base score alone matching one particular case.
    const base = scoreEvidence(evidence({ schemaParsed: true }))
    expect(scoreEvidence(evidence({ schemaParsed: true, checksumValid: null }))).toBe(base)
    expect(scoreEvidence(evidence({ schemaParsed: true, crossPassAgreed: null }))).toBe(base)
    expect(scoreEvidence(evidence({ schemaParsed: true, boxPlausible: null }))).toBe(base)
  })
})

describe('withCrossPass', () => {
  const candidate = (raw: string): Candidate =>
    ({ key: 'dl_number', raw, evidence: { ...NO_EVIDENCE, schemaParsed: true } })

  it('marks agreement when the plain pass contains the same value', () => {
    const [out] = withCrossPass([candidate('I1234568')], 'DL I1234568 EXP 2029')
    expect(out?.evidence.crossPassAgreed).toBe(true)
  })

  it('marks disagreement when it does not', () => {
    const [out] = withCrossPass([candidate('11234568')], 'DL I1234568 EXP 2029')
    expect(out?.evidence.crossPassAgreed).toBe(false)
  })

  it('leaves the signal unset when there is no plain pass to compare', () => {
    const [out] = withCrossPass([candidate('11234568')], '')
    expect(out?.evidence.crossPassAgreed).toBeNull()
  })

  it('leaves a one-character value unset rather than crediting it with agreement', () => {
    // A sex marker or a licence class is a substring of almost any haystack:
    // 'SEX M DOB 1990' contains 'M' by construction, not by corroboration.
    // Scoring that as agreement is the false-confidence bug this module
    // exists to prevent, just one level up from the glyph signal.
    const single: Candidate = {
      key: 'sex', raw: 'M', evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([single], 'SEX M DOB 1990')
    expect(out?.evidence.crossPassAgreed).toBeNull()
  })

  it('still scores a genuine one-character disagreement as absent, not false', () => {
    // The guard is length-based, not "look up the value" — a one-character
    // value gets null even when the haystack plainly lacks it too.
    const single: Candidate = {
      key: 'sex', raw: 'M', evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([single], 'SEX F DOB 1990')
    expect(out?.evidence.crossPassAgreed).toBeNull()
  })

  it('still evaluates a genuine two-character value normally', () => {
    const two: Candidate = {
      key: 'addr_state', raw: 'CA', evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [agrees] = withCrossPass([two], 'ADDRESS SACRAMENTO CA 95814')
    expect(agrees?.evidence.crossPassAgreed).toBe(true)
    const [disagrees] = withCrossPass([two], 'ADDRESS SEATTLE WA 98101')
    expect(disagrees?.evidence.crossPassAgreed).toBe(false)
  })
})
