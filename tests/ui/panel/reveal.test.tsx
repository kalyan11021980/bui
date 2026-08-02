import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldRow } from '@/ui/panel/FieldRow'
import { fieldInputId } from '@/ui/panel/FieldControl'
import { revealField } from '@/ui/panel/reveal'

/**
 * jsdom implements neither `scrollIntoView` nor `matchMedia`, so both are
 * installed per test rather than assumed. That is also why `reveal` feature-
 * detects `scrollIntoView`: the focus half of the behaviour must not die on
 * the scroll half.
 */
function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('revealField', () => {
  it('scrolls the field into view and puts the caret in it', () => {
    render(<FieldRow fieldId="biz_addr_line1" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const input = document.getElementById(fieldInputId('biz_addr_line1'))!
    const scroll = vi.fn()
    input.scrollIntoView = scroll
    stubMatchMedia(false)

    revealField('biz_addr_line1')

    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(document.activeElement).toBe(input)
  })

  it('does not animate when the user has asked for less motion', () => {
    // A smooth scroll is exactly the vestibular trigger that setting exists
    // for. Honouring it is not optional, and the field still gets revealed.
    render(<FieldRow fieldId="biz_addr_line1" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const input = document.getElementById(fieldInputId('biz_addr_line1'))!
    const scroll = vi.fn()
    input.scrollIntoView = scroll
    stubMatchMedia(true)

    revealField('biz_addr_line1')

    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
    expect(document.activeElement).toBe(input)
  })

  it('does nothing at all for a field that is not on screen', () => {
    // A read-only row has no input to focus. Throwing here would take the
    // whole panel down over an acknowledgement.
    render(<FieldRow fieldId="first_name" state={{ value: 'Ada', status: 'confirmed' }} />)
    expect(() => revealField('biz_addr_line1')).not.toThrow()
  })

  it('survives an environment with no scrollIntoView', () => {
    render(<FieldRow fieldId="biz_addr_line1" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    stubMatchMedia(false)
    expect(() => revealField('biz_addr_line1')).not.toThrow()
    expect(document.activeElement).toBe(
      screen.getByLabelText(/business address/i, { selector: 'input' }),
    )
  })
})
