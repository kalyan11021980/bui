import { describe, it, expect } from 'vitest'
import { formatValue } from '@/ui/panel/format'

describe('formatValue', () => {
  it('renders a string unchanged', () => {
    expect(formatValue('2345 Anywhere St', 'address')).toBe('2345 Anywhere St')
  })

  it('separates a list instead of running it together', () => {
    // String(['a','b']) is 'a,b' — no gap to read, and indistinguishable from
    // a single value that happens to contain a comma.
    expect(formatValue(['a', 'b'], 'text')).toBe('a, b')
  })

  it('leads a multi-file list with its count', () => {
    expect(formatValue(['front.jpg', 'back.jpg'], 'file'))
      .toBe('2 files: front.jpg, back.jpg')
  })

  it('does not count a single file at the applicant', () => {
    expect(formatValue(['front.jpg'], 'file')).toBe('front.jpg')
  })

  it('never renders [object Object]', () => {
    const rendered = formatValue({ street: '2345 Anywhere St' }, 'address')
    expect(rendered).not.toContain('[object Object]')
    expect(rendered).toContain('2345 Anywhere St')
  })

  it('never renders [object Object] inside a list either', () => {
    const rendered = formatValue([{ a: 1 }, { b: 2 }], 'text')
    expect(rendered).not.toContain('[object Object]')
  })

  it('renders nothing for an absent value', () => {
    expect(formatValue(null, 'text')).toBe('')
    expect(formatValue(undefined, 'text')).toBe('')
    expect(formatValue([], 'file')).toBe('')
  })

  it('renders numbers and booleans plainly', () => {
    expect(formatValue(42, 'text')).toBe('42')
    expect(formatValue(false, 'text')).toBe('false')
  })

  it('survives a value that cannot be serialised', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => formatValue(circular, 'text')).not.toThrow()
  })
})
