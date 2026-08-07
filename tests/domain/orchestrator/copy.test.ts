import { describe, it, expect } from 'vitest'
import { COPY, COPY_VERSION, vettedCopy, ALL_COPY_IDS } from '@/domain/orchestrator/copy'

describe('vetted copy', () => {
  it('has a non-empty string for every declared id', () => {
    expect(ALL_COPY_IDS.length).toBeGreaterThan(3)
    for (const id of ALL_COPY_IDS) {
      expect(vettedCopy(id).trim(), id).not.toBe('')
    }
  })

  it('throws on an unknown id rather than returning a blank', () => {
    // @ts-expect-error deliberately outside the union
    expect(() => vettedCopy('no_such_copy')).toThrow(/no_such_copy/)
  })

  it('carries the opening beat verbatim from the spec', () => {
    const beat = vettedCopy('opening_beat')
    expect(beat).toContain("I'm your registration agent")
    expect(beat).toContain('about four minutes')
    expect(beat).toContain('state law requires a human to verify dealer licenses')
  })

  it('declares a version so a copy change is detectable', () => {
    expect(COPY_VERSION).toMatch(/^\d+$/)
  })

  it('exposes COPY as the same data vettedCopy reads', () => {
    for (const id of ALL_COPY_IDS) expect(COPY[id]).toBe(vettedCopy(id))
  })

  it('carries the section-flow copy under version 7', () => {
    expect(COPY_VERSION).toBe('7')
    expect(vettedCopy('done_chip')).toBe("Done with this section — what's next?")
    expect(vettedCopy('section_incomplete')).toBe(
      "A few answers in this section are still blank — they're marked below.",
    )
  })
})
