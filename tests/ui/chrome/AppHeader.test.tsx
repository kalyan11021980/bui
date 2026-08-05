import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppHeader } from '@/ui/chrome/AppHeader'
import { vettedCopy } from '@/domain/orchestrator/copy'

describe('AppHeader', () => {
  it('is a banner carrying the product name and the vetted reassurance line', () => {
    render(<AppHeader />)
    const banner = screen.getByRole('banner')
    expect(banner).toHaveTextContent('Buyer Registration')
    expect(banner).toHaveTextContent(vettedCopy('header_reassurance'))
  })
})
