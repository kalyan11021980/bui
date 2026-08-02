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

  it('renders a field addressed by an instance-qualified key', () => {
    // fieldDef is keyed by bare FieldId; `license_number#0` only resolves if
    // the lookup runs through parseReqKey. Without this test, simplifying it
    // to fieldDef(fieldId) passes the whole suite and throws at runtime.
    // Instance 0 must read as "1" to the user — 0-based internally, 1-based
    // on screen.
    render(
      <FieldRow
        fieldId="license_number#0"
        state={{ value: 'GA-DLR-44812', status: 'confirmed' }}
      />,
    )
    expect(screen.getByRole('group', { name: /^license number 1$/i })).toBeInTheDocument()
    expect(screen.getByText('GA-DLR-44812')).toBeInTheDocument()
    expect(screen.getByText(/verify this against your state dealer board/i))
      .toBeInTheDocument()
  })

  it('gives a non-instanced field its plain label, with no stray number', () => {
    // Only repeated (licence) fields get a numeric suffix. A bug that always
    // appends the instance number would corrupt every ordinary field's label.
    render(<FieldRow fieldId="first_name" state={undefined} />)
    expect(screen.getByRole('group', { name: /^first name$/i })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /first name 1/i })).toBeNull()
  })

  it('keeps describedby ids unique across licence instances', () => {
    render(
      <>
        <FieldRow fieldId="license_number#0" state={{ value: 'A', status: 'confirmed' }} />
        <FieldRow fieldId="license_number#1" state={{ value: 'B', status: 'confirmed' }} />
      </>,
    )
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = screen.getAllByRole('group', { name: /license number/i })
    expect(groups).toHaveLength(2)
    expect(groups[0]?.getAttribute('aria-describedby'))
      .not.toBe(groups[1]?.getAttribute('aria-describedby'))
  })

  it('gives each licence instance a distinct accessible name', () => {
    // The bug this guards against: both rows sharing the bare "License
    // number" label, which leaves a screen-reader user unable to tell the
    // dealer licence row from the salvage licence row.
    render(
      <>
        <FieldRow fieldId="license_number#0" state={{ value: 'A', status: 'confirmed' }} />
        <FieldRow fieldId="license_number#1" state={{ value: 'B', status: 'confirmed' }} />
      </>,
    )
    expect(screen.getByRole('group', { name: /^license number 1$/i })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /^license number 2$/i })).toBeInTheDocument()
  })

  it('passes the full instance-qualified key to onConfirm, not the bare FieldId', async () => {
    // Task 10 dispatches a reducer action keyed by whatever onConfirm
    // receives. A truncated key (`license_number` instead of
    // `license_number#0`) would silently confirm the wrong licence instance.
    const onConfirm = vi.fn()
    render(
      <FieldRow
        fieldId="license_number#0"
        state={{ value: 'GA-DLR-44812', status: 'derived', provenance: { source: 'ocr' } }}
        onConfirm={onConfirm}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /looks right/i }))
    expect(onConfirm).toHaveBeenCalledWith('license_number#0')
  })
})
