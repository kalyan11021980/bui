import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldRow } from '@/ui/panel/FieldRow'
import type { FieldState } from '@/domain/application/state'

const derived: FieldState = {
  value: '1982-08-31',
  status: 'derived',
  provenance: { source: 'ocr', confidence: 0.96, documentId: 'doc-1' },
}

describe('FieldRow', () => {
  it('always shows why the field is needed', () => {
    render(<FieldRow fieldId="dob" state={undefined} />)
    expect(screen.getByText(/confirms you are old enough/i)).toBeInTheDocument()
  })

  it('names the authority that requires it', () => {
    render(<FieldRow fieldId="tax_id" state={undefined} />)
    // Scoped to the "Required by ..." line specifically: tax_id's `consequence`
    // copy also mentions "the IRS", so an unscoped match is ambiguous.
    expect(screen.getByText(/required by the irs/i)).toBeInTheDocument()
  })

  it('shows handling copy for a sensitive field without any interaction', () => {
    render(<FieldRow fieldId="tax_id" state={undefined} />)
    expect(screen.getByText(/encrypted at rest/i)).toBeInTheDocument()
  })

  it('offers a confirm affordance for a derived value', async () => {
    const onConfirm = vi.fn()
    render(<FieldRow fieldId="dob" state={derived} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: /looks right/i }))
    expect(onConfirm).toHaveBeenCalledWith('dob')
  })

  it('attributes a derived value to its source', () => {
    render(<FieldRow fieldId="dob" state={derived} />)
    expect(screen.getByText(/from your document/i)).toBeInTheDocument()
  })

  it('asks the user to check a carried value rather than stating it as fact', () => {
    render(
      <FieldRow
        fieldId="biz_addr_line1"
        state={{
          value: '2345 Anywhere St',
          status: 'derived',
          provenance: { source: 'carried', fromFieldId: 'addr_line1' },
        }}
      />,
    )
    expect(screen.getByText(/check it belongs here/i)).toBeInTheDocument()
  })

  it('does not offer confirm once the value is confirmed', () => {
    render(
      <FieldRow fieldId="dob" state={{ ...derived, status: 'confirmed' }} />,
    )
    expect(screen.queryByRole('button', { name: /looks right/i })).toBeNull()
  })

  it('shows a human-readable rejection reason', () => {
    render(
      <FieldRow
        fieldId="id_images"
        state={{
          value: ['img-1'],
          status: 'rejected',
          rejection: {
            reason: 'The photo was too dark to read your license number',
            at: '2026-08-01T12:00:00.000Z',
          },
        }}
      />,
    )
    expect(screen.getByText(/too dark to read/i)).toBeInTheDocument()
  })

  it('announces provenance to screen readers', () => {
    render(<FieldRow fieldId="dob" state={derived} />)
    const row = screen.getByRole('group', { name: /date of birth/i })
    expect(row).toHaveAttribute('aria-describedby')
  })
})
