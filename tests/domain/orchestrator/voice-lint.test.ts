import { describe, it, expect } from 'vitest'
import { lintVoice, tidyVoice } from '@/domain/orchestrator/voice-lint'

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
  ['x'.repeat(1001), 'length'],
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
    expect(lintVoice('a'.repeat(1000))).toEqual({ ok: true })
    expect(lintVoice('a'.repeat(1001)).ok).toBe(false)
  })

  it('accepts a fuller markdown answer with bullets and bold, no numerals', () => {
    const answer = [
      'Here is what we still need from you:',
      '',
      '- **Who you are** — your full legal name and date of birth',
      '- **Where you live** — a current residential address',
      '- **What you do** — the business activity you want to register',
      '',
      'A photo of your licence would answer several of these at once.',
    ].join('\n')
    expect(lintVoice(answer)).toEqual({ ok: true })
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

describe('tidyVoice', () => {
  // Kaly calls the em dash "the AI dash". A prompt ban alone leaks — the model
  // slips, or swaps in an en dash — so tidyVoice is the guarantee none reaches
  // the applicant. Both dash kinds become a comma; a leading comma left behind
  // is trimmed, and doubled commas collapse.
  it('turns an em dash into a comma', () => {
    expect(tidyVoice('Straightforward — we will go through it together.'))
      .toBe('Straightforward, we will go through it together.')
  })

  it('turns an en dash into a comma', () => {
    expect(tidyVoice('A few items – then we are done.'))
      .toBe('A few items, then we are done.')
  })

  it('collapses the doubled comma a leading dash leaves behind', () => {
    expect(tidyVoice('Right, — a couple more.')).toBe('Right, a couple more.')
  })

  it('trims a comma left at the front by a leading dash', () => {
    expect(tidyVoice('— here is what comes next.')).toBe('here is what comes next.')
  })

  it('leaves a dash-free line untouched', () => {
    expect(tidyVoice('Sure, here is exactly why we ask.'))
      .toBe('Sure, here is exactly why we ask.')
  })
})
