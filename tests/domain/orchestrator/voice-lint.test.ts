import { describe, it, expect } from 'vitest'
import { lintVoice } from '@/domain/orchestrator/voice-lint'

const PASSING = [
  'Thanks — let me get a couple of details from you.',
  'Sure, here is exactly why we ask:',
  'Nearly there. Just a few more.',
  'Let me explain (briefly) why we ask.',
]

const FAILING: ReadonlyArray<[string, string]> = [
  ['[askFor(field: "id_images")]', 'tool_syntax'],
  ['I will askFor (your name) next.', 'tool_syntax'],
  ['[explain(dob)]', 'tool_syntax'],
  ['setProfile({ patch }) comes next.', 'tool_syntax'],
  ['Askfor(first name) coming up.', 'tool_syntax'],
  ['You have 3 things left.', 'numeral'],
  ['Almost ninety percent done.', 'percentage'],
  ['This is 90% done.', 'percentage'],
  ['Required under 26 U.S.C. for reporting.', 'statute'],
  ['See § 1234 for details.', 'statute'],
  ['Refer to the CFR for this one.', 'statute'],
  ['You must provide this.', 'legal_claim'],
  ['This is required by law.', 'legal_claim'],
  ['You are liable for errors here.', 'legal_claim'],
  ['x'.repeat(241), 'length'],
]

describe('lintVoice', () => {
  it.each(PASSING)('accepts ordinary conversational voice: %s', (text) => {
    expect(lintVoice(text)).toEqual({ ok: true })
  })

  it.each(FAILING)('rejects %s as %s', (text, violation) => {
    const result = lintVoice(text)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a rejection')
    expect(result.violation).toBe(violation)
  })

  it('accepts a string at the length limit and rejects one past it', () => {
    expect(lintVoice('a'.repeat(240))).toEqual({ ok: true })
    expect(lintVoice('a'.repeat(241)).ok).toBe(false)
  })

  it('rejects non-ASCII digits, not just 0-9', () => {
    expect(lintVoice('You have ٣ left.').ok).toBe(false)
  })

  it('drops a bracketed completed-tool marker as tool syntax', () => {
    expect(lintVoice('[explained: location_country]'))
      .toEqual({ ok: false, violation: 'tool_syntax' })
  })

  it('still drops bracketed call syntax', () => {
    expect(lintVoice('[askFor(field: last_name)]'))
      .toEqual({ ok: false, violation: 'tool_syntax' })
  })

  it('keeps ordinary bracketed prose without a marker shape', () => {
    expect(lintVoice('We ask [almost] nothing else.')).toEqual({ ok: true })
  })
})
