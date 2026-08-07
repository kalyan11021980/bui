import { describe, expect, it } from 'vitest'
import { bandForWidth } from '@/domain/ocr/quality'

describe('bandForWidth', () => {
  it('reads at or above the recognition floor', () => {
    // The gate measured 12/12 fields read at 405px. Under the Mistral-markdown
    // pipeline every legible read is text-only — there are no boxes, so there
    // is no fuller band.
    expect(bandForWidth(1600)).toBe('text-only')
    expect(bandForWidth(1000)).toBe('text-only')
    expect(bandForWidth(405)).toBe('text-only')
    expect(bandForWidth(400)).toBe('text-only')
  })

  it('asks for another photo below the recognition floor', () => {
    expect(bandForWidth(399)).toBe('re-take')
    expect(bandForWidth(202)).toBe('re-take')
    expect(bandForWidth(0)).toBe('re-take')
  })
})