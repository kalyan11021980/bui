import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Suggestions } from '@/ui/chat/Suggestions'

describe('Suggestions', () => {
  it('builds a why-chip from an ordinary label', () => {
    render(<Suggestions fieldIds={['first_name']} disabled={false} onPick={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Why do you need my first name?' })).toBeInTheDocument()
  })

  /**
   * The label is already a question ("Which ID will you use?"). The plain
   * template would double the question mark and lowercase it into nonsense:
   * "Why do you need my which id will you use??".
   */
  it('quotes a question-shaped label instead of folding it into the "need my…" template', () => {
    render(<Suggestions fieldIds={['id_form']} disabled={false} onPick={vi.fn()} />)
    const chip = screen.getByRole('button', { name: 'Why do you ask “Which ID will you use?”' })
    expect(chip).toBeInTheDocument()
    expect(chip.textContent).not.toContain('??')
    expect(chip.textContent).not.toContain('which id will you use')
  })
})
