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

  it('keeps a checksum-validated identifier quiet with no label, the real MRZ shape', () => {
    // aamva.ts and labelled.ts never set checksumValid; mrz.ts never sets
    // labelAnchored. The combination above never comes off a real document —
    // this one, checksum alone, is what an actual MRZ field scores.
    const score = scoreEvidence(evidence({
      schemaParsed: true, checksumValid: true, glyphAmbiguous: true,
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

  it('does not score a null signal as failure, for each nullable signal individually', () => {
    // A single test comparing two already-null defaults would pass whether
    // or not null is scored as failure, as long as both sides are null the
    // same way — it proves nothing. This sets each of the three nullable
    // signals to false and to null in turn and checks null never scores
    // below the untouched base, and specifically is not equal to false.
    const base = scoreEvidence(evidence({ schemaParsed: true }))
    for (const signal of ['checksumValid', 'crossPassAgreed', 'boxPlausible'] as const) {
      const withNull = scoreEvidence(evidence({ schemaParsed: true, [signal]: null }))
      const withFalse = scoreEvidence(evidence({ schemaParsed: true, [signal]: false }))
      expect(withNull, signal).toBe(base)
      expect(withNull, signal).toBeGreaterThan(withFalse)
    }
  })

  it('keeps a value noisy on cross-pass disagreement even when checksum-validated', () => {
    // A disagreement between the two OCR passes must not be out-voted by a
    // checksum, a label anchor and a plausible box acting together.
    const score = scoreEvidence(evidence({
      schemaParsed: true, labelAnchored: true, checksumValid: true,
      boxPlausible: true, crossPassAgreed: false,
    }))
    expect(score).toBeLessThan(QUIET_THRESHOLD)
  })

  it('never goes quiet on cross-pass disagreement, across every other combination', () => {
    // The exhaustive version of the test above: crossPassAgreed: false must
    // dominate regardless of what else is true, not just in the one
    // hand-picked worst case.
    const flags = [true, false, null] as const
    for (const checksumValid of flags) {
      for (const boxPlausible of flags) {
        for (const glyphAmbiguous of flags) {
          for (const labelAnchored of [true, false]) {
            const score = scoreEvidence(evidence({
              schemaParsed: true, labelAnchored, checksumValid, boxPlausible,
              glyphAmbiguous, crossPassAgreed: false,
            }))
            expect(score).toBeLessThan(QUIET_THRESHOLD)
          }
        }
      }
    }
  })

  it('rounds away floating-point noise instead of leaking it into a displayed score', () => {
    // 0.3 + 0.6 is 0.8999999999999999 in IEEE 754. Without the toFixed(3)
    // step this returns that value verbatim.
    const score = scoreEvidence(evidence({ schemaParsed: true, crossPassAgreed: true }))
    expect(score).toBe(0.9)
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

  it('credits a standalone one-character value with genuine agreement', () => {
    const single: Candidate = {
      key: 'sex', raw: 'M', evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([single], 'SEX M DOB 1990')
    expect(out?.evidence.crossPassAgreed).toBe(true)
  })

  it('does not credit a one-character value embedded inside a longer word', () => {
    // A naive substring match finds 'M' inside 'MARIA'. A name that starts
    // with the same letter as a sex marker is not corroboration of it.
    const single: Candidate = {
      key: 'sex', raw: 'M', evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([single], 'PATIENT NAME MARIA SMITH')
    expect(out?.evidence.crossPassAgreed).toBe(false)
  })

  it('credits a standalone two-character state code with genuine agreement', () => {
    const two: Candidate = {
      key: 'addr_state', raw: 'CA', evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([two], 'ADDRESS SACRAMENTO CA 95814')
    expect(out?.evidence.crossPassAgreed).toBe(true)
  })

  it('does not credit a two-character state code embedded inside a longer word', () => {
    // 'CA' is a substring of 'CALIFORNIA'; 'WA' is a substring of
    // 'WASHINGTON'. Deliberately wrong two-character codes against real
    // plain passes were the reviewer's own counterexample for this.
    const two: Candidate = {
      key: 'addr_state', raw: 'CA', evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([two], 'ADDRESS SACRAMENTO CALIFORNIA 95814')
    expect(out?.evidence.crossPassAgreed).toBe(false)
  })

  it('compares asRead, not the ISO-converted raw, when a candidate carries one', () => {
    // A date candidate's raw is ISO (1977-08-31); the plain pass only ever
    // saw the printed form. Comparing raw here would manufacture a
    // disagreement out of a formatting choice, not a misread.
    const dateCandidate: Candidate = {
      key: 'dob', raw: '1977-08-31', asRead: '08/31/1977',
      evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([dateCandidate], 'DOB 08/31/1977')
    expect(out?.evidence.crossPassAgreed).toBe(true)
  })

  it('still detects a genuine disagreement on the as-read form', () => {
    const dateCandidate: Candidate = {
      key: 'dob', raw: '1977-08-31', asRead: '08/31/1977',
      evidence: { ...NO_EVIDENCE, schemaParsed: true },
    }
    const [out] = withCrossPass([dateCandidate], 'DOB 08/13/1977')
    expect(out?.evidence.crossPassAgreed).toBe(false)
  })
})
