import { describe, expect, it, vi } from 'vitest'
import { extractFields } from '@/server/ocr/llm-extract'

const TEXT = '# WA DRIVER LICENSE\n\nWDLJK00580GF ...'

describe('extractFields', () => {
  it('maps a JSON object to candidates', async () => {
    const candidates = await extractFields(
      async () => '{"dl_number": "D1234567", "first_name": "Ada"}',
      'drivers_license', TEXT,
    )

    expect(candidates.map((c) => [c.key, c.raw])).toEqual([
      ['dl_number', 'D1234567'],
      ['first_name', 'Ada'],
    ])
  })

  it('strips a json fence around the answer', async () => {
    const candidates = await extractFields(
      async () => '```json\n{"dl_number": "D1234567"}\n```',
      'drivers_license', TEXT,
    )

    expect(candidates).toEqual([
      expect.objectContaining({ key: 'dl_number', raw: 'D1234567' }),
    ])
  })

  it('returns nothing on garbage JSON — a malformed answer is a read of nothing, not a crash', async () => {
    expect(await extractFields(async () => 'not json at all', 'drivers_license', TEXT))
      .toEqual([])
  })

  it('returns nothing on a non-object answer', async () => {
    expect(await extractFields(async () => '["dl_number"]', 'drivers_license', TEXT))
      .toEqual([])
  })

  it('drops keys the catalog does not allow for the document', async () => {
    // passport_number is derivable from a passport, not a licence — the
    // derivable contract is the catalog's call, not the model's.
    const candidates = await extractFields(
      async () => '{"passport_number": "X123456", "made_up_field": "nope", "dl_number": "D1234567"}',
      'drivers_license', TEXT,
    )

    expect(candidates.map((c) => c.key)).toEqual(['dl_number'])
  })

  it('drops blank and non-string values', async () => {
    const candidates = await extractFields(
      async () => '{"dl_number": "  ", "first_name": 42, "last_name": "Lovelace"}',
      'drivers_license', TEXT,
    )

    expect(candidates).toEqual([
      expect.objectContaining({ key: 'last_name', raw: 'Lovelace' }),
    ])
  })

  it('never calls the model on a blank read', async () => {
    const complete = vi.fn(async () => '{}')
    expect(await extractFields(complete, 'drivers_license', '   ')).toEqual([])
    expect(complete).not.toHaveBeenCalled()
  })

  it('flags glyph ambiguity on a confusable identifier', async () => {
    // The CA card's `I1234568` came back `11234568` — a different number.
    const candidates = await extractFields(
      async () => '{"dl_number": "I1234568"}', 'drivers_license', TEXT,
    )
    expect(candidates[0]?.evidence.glyphAmbiguous).toBe(true)
  })

  it('clears it on a clean identifier', async () => {
    const candidates = await extractFields(
      async () => '{"dl_number": "D234679"}', 'drivers_license', TEXT,
    )
    expect(candidates[0]?.evidence.glyphAmbiguous).toBe(false)
  })

  it('leaves it null where the field is not identifier-shaped', async () => {
    const candidates = await extractFields(
      async () => '{"first_name": "Ada"}', 'drivers_license', TEXT,
    )
    expect(candidates[0]?.evidence.glyphAmbiguous).toBeNull()
  })

  it('lists the fields derivable from the document, and no others', async () => {
    let prompt = ''
    await extractFields(async (p) => { prompt = p; return '{}' }, 'drivers_license', TEXT)

    expect(prompt).toContain('dl_number')
    expect(prompt).toContain('drivers_license')
    // Not derivable from a licence, and file uploads are never extracted.
    expect(prompt).not.toContain('passport_number')
    expect(prompt).not.toContain('id_images')
    expect(prompt).not.toContain('proof_of_residency')
  })

  it('never calls the model for a document with no extractable fields', async () => {
    // proof_of_residency's only derivable field is the file upload itself.
    const complete = vi.fn(async () => '{}')
    expect(await extractFields(complete, 'proof_of_residency', TEXT)).toEqual([])
    expect(complete).not.toHaveBeenCalled()
  })
})
