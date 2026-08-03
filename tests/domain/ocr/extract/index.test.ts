import { describe, expect, it } from 'vitest'
import { extractFor, parseCandidates, registerStrategy } from '@/domain/ocr/extract'
import { glyphAmbiguity, NO_EVIDENCE } from '@/domain/ocr/extract/types'
import type { Candidate, Evidence } from '@/domain/ocr/extract/types'

const noEvidence: Evidence = {
  schemaParsed: false, labelAnchored: false,
  checksumValid: null, crossPassAgreed: null, boxPlausible: null,
  glyphAmbiguous: null,
}

const candidate = (key: string, raw: string): Candidate =>
  ({ key, raw, evidence: { ...noEvidence } })

describe('extractFor', () => {
  it('returns nothing for a document type with no strategy', () => {
    expect(extractFor('proof_of_residency', [], '')).toEqual([])
  })

  it('routes to the registered strategy', () => {
    registerStrategy('state_id', () => [candidate('first_name', 'JAMIE')])
    const out = extractFor('state_id', [], '')
    expect(out).toHaveLength(1)
    expect(out[0]?.key).toBe('first_name')
  })

  it('does not hand another document type the state_id strategy', () => {
    // Registered above — a lookup keyed on docType, not "whatever is registered".
    expect(extractFor('drivers_license', [], '')).toEqual([])
  })
})

describe('parseCandidates', () => {
  it('keeps a value its field schema accepts, and records that it parsed', () => {
    const [kept] = parseCandidates([candidate('dob', '1982-04-17')])
    expect(kept?.raw).toBe('1982-04-17')
    expect(kept?.evidence.schemaParsed).toBe(true)
  })

  it('drops a value the schema rejects rather than lowering its score', () => {
    // A date that is not a date is not a low-confidence date.
    expect(parseCandidates([candidate('dob', '1982-13-45')])).toEqual([])
  })

  it('drops a licence number too short to be one', () => {
    expect(parseCandidates([candidate('dl_number', 'A1')])).toEqual([])
  })

  it('parses an instanced key against its bare field definition', () => {
    const kept = parseCandidates([candidate('license_number#0', 'GA-DLR-99481')])
    expect(kept).toHaveLength(1)
  })

  it('drops a candidate for a field that is not in the catalog', () => {
    expect(parseCandidates([candidate('not_a_field', 'x')])).toEqual([])
  })

  it('carries the rest of the evidence through untouched, only flipping schemaParsed', () => {
    const withEvidence: Candidate = {
      key: 'dob',
      raw: '1982-04-17',
      evidence: {
        schemaParsed: false,
        labelAnchored: true,
        checksumValid: null,
        crossPassAgreed: false,
        boxPlausible: false,
        glyphAmbiguous: true,
      },
    }
    const [kept] = parseCandidates([withEvidence])
    expect(kept?.evidence).toEqual({
      schemaParsed: true,
      labelAnchored: true,
      checksumValid: null,
      crossPassAgreed: false,
      boxPlausible: false,
      glyphAmbiguous: true,
    })
  })
})

describe('glyphAmbiguity', () => {
  it('flags an identifier containing any of the confusable glyphs', () => {
    for (const raw of ['I1234568', 'A0000', 'SB5', 'x8x']) {
      expect(glyphAmbiguity('dl_number', raw), raw).toBe(true)
    }
  })

  it('does not flag an identifier made only of unambiguous characters', () => {
    for (const raw of ['A9999999', 'WDJK4267', '243-79']) {
      expect(glyphAmbiguity('dl_number', raw), raw).toBe(false)
    }
  })

  it('applies to every identifier-shaped field, instanced or not', () => {
    for (const key of ['id_number', 'passport_number', 'license_number#0']) {
      expect(glyphAmbiguity(key, 'I0'), key).toBe(true)
    }
  })

  it('is null where the confusion cannot arise or does not change the meaning', () => {
    // A surname read SAMPLE for 5AMPLE is a misread we catch elsewhere; a
    // date is validated; an address is checked against a real one.
    for (const key of ['first_name', 'last_name', 'dob', 'dl_expiry', 'addr_line1']) {
      expect(glyphAmbiguity(key, 'SB1050'), key).toBeNull()
    }
  })

  it('is null for a key that is not a field at all', () => {
    expect(glyphAmbiguity('license_number#nope', 'I0')).toBeNull()
  })

  it('leaves NO_EVIDENCE saying the signal has not been assessed', () => {
    expect(NO_EVIDENCE.glyphAmbiguous).toBeNull()
  })
})
