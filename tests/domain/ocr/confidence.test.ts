import { describe, expect, it } from 'vitest'
import { QUIET_THRESHOLD, scoreEvidence } from '@/domain/ocr/confidence'
import { NO_EVIDENCE } from '@/domain/ocr/extract/types'
import type { Evidence } from '@/domain/ocr/extract/types'

const evidence = (patch: Partial<Evidence>): Evidence => ({ ...NO_EVIDENCE, ...patch })

describe('scoreEvidence', () => {
  it('stays within bounds for every reachable combination', () => {
    for (const schemaParsed of [true, false]) {
      for (const glyphAmbiguous of [true, false, null] as const) {
        const score = scoreEvidence(evidence({ schemaParsed, glyphAmbiguous }))
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(1)
      }
    }
  })

  it('scores zero when the value never parsed', () => {
    // A schema failure is not "low confidence" — it is a value upstream should
    // have dropped. An ambiguous glyph must not claw back above 0 either.
    expect(scoreEvidence(evidence({ schemaParsed: false, glyphAmbiguous: true }))).toBe(0)
  })

  it('rates a clean schema-parsed read at or above the quiet threshold', () => {
    // The model read the document and the value parsed against its catalog
    // schema — that is a confident read, and the row goes quiet.
    expect(scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous: null })))
      .toBeGreaterThanOrEqual(QUIET_THRESHOLD)
    expect(scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous: false })))
      .toBeGreaterThanOrEqual(QUIET_THRESHOLD)
  })

  it('drops a glyph-ambiguous identifier below the quiet threshold', () => {
    // `I1234568` read as `11234568`: schema-happy, and wrong. The glyph signal
    // is the only thing that can see it, so it is the only thing that surfaces
    // the "hard to read" line.
    const ambiguous = scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous: true }))
    const clean = scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous: false }))
    expect(ambiguous).toBeLessThan(QUIET_THRESHOLD)
    expect(ambiguous).toBeLessThan(clean)
  })

  it('does not score a null glyph signal as ambiguity', () => {
    // null is "does not apply" — a field that cannot be glyph-ambiguous has
    // earned nothing and lost nothing relative to an unambiguous identifier.
    expect(scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous: null })))
      .toBe(scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous: false })))
  })

  it('never lands exactly on the quiet threshold', () => {
    // An exact tie is one weight nudge away from silently flipping whether the
    // "hard to read" line shows. The two reachable scores are 0.9 and 0.7.
    for (const glyphAmbiguous of [true, false, null] as const) {
      expect(scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous })))
        .not.toBe(QUIET_THRESHOLD)
    }
  })

  it('rounds away floating-point noise instead of leaking it into a displayed score', () => {
    // 0.9 - 0.2 is 0.7000000000000001 in IEEE 754. Without the toFixed(3) step
    // this returns that value verbatim.
    expect(scoreEvidence(evidence({ schemaParsed: true, glyphAmbiguous: true }))).toBe(0.7)
  })
})