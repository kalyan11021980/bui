import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Suggestions } from '@/ui/chat/Suggestions'

describe('Suggestions', () => {
  it('builds a why-chip from the current field\'s ordinary label', () => {
    render(<Suggestions currentField="first_name" disabled={false} onPick={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Why do you need my first name?' })).toBeInTheDocument()
  })

  /**
   * The label is already a question ("Which ID will you use?"). The plain
   * template would double the question mark and lowercase it into nonsense:
   * "Why do you need my which id will you use??".
   */
  it('quotes a question-shaped label instead of folding it into the "need my…" template', () => {
    render(<Suggestions currentField="id_form" disabled={false} onPick={vi.fn()} />)
    const chip = screen.getByRole('button', { name: 'Why do you ask “Which ID will you use?”' })
    expect(chip).toBeInTheDocument()
    expect(chip.textContent).not.toContain('??')
    expect(chip.textContent).not.toContain('which id will you use')
  })

  // The chips track the section the applicant is in, not a fixed list: a
  // why-chip for the field they are on, plus a next-step and a progress prompt.
  it('offers a next-step and a progress chip alongside the why-chip', () => {
    render(<Suggestions currentField="addr_city" disabled={false} onPick={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Why do you need my city?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What’s my next step?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How much is left?' })).toBeInTheDocument()
  })

  it('renders nothing once nothing is outstanding (currentField is null)', () => {
    const { container } = render(<Suggestions currentField={null} disabled={false} onPick={vi.fn()} />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders nothing while sending is unavailable', () => {
    const { container } = render(<Suggestions currentField="first_name" disabled onPick={vi.fn()} />)
    expect(container.querySelector('button')).toBeNull()
  })
})