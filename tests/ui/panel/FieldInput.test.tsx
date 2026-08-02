import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldRow } from '@/ui/panel/FieldRow'
import { fieldInputId } from '@/ui/panel/FieldInput'
import { COLOR } from '@/ui/theme/tokens'

/**
 * The row's wrapper carries `aria-label` too (it is a labelled group), so an
 * unscoped getByLabelText matches both it and the control. Scoping to the
 * form element is what asserts an INPUT exists — the whole point of C4.
 */
const CONTROL = { selector: 'input, select, textarea' } as const
const control = (label: RegExp) => screen.getByLabelText(label, CONTROL)
const queryControl = (label: RegExp) => screen.queryByLabelText(label, CONTROL)

/**
 * Phase 1's exit criterion (§15) is that a user can complete a registration
 * through the panel. Before this wave `grep -rnE "<input|<select"` over src/
 * returned nothing at all: the panel could display an application and never
 * accept one.
 */
describe('FieldInput — the panel accepts data', () => {
  it('renders a text input for a text field, labelled by the visible label', () => {
    render(<FieldRow fieldId="first_name" state={undefined} onChange={vi.fn()} />)
    const input = control(/first name/i)
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'text')
  })

  it('renders a date input for a date field', () => {
    render(<FieldRow fieldId="dob" state={undefined} onChange={vi.fn()} />)
    expect(control(/date of birth/i)).toHaveAttribute('type', 'date')
  })

  it('renders a tel input for a phone field', () => {
    render(<FieldRow fieldId="phone_mobile" state={undefined} onChange={vi.fn()} />)
    expect(control(/mobile phone/i)).toHaveAttribute('type', 'tel')
  })

  it('renders a text input for a taxpayer ID, not a password field', () => {
    // Hiding what you typed from yourself is how a mistyped SSN gets filed.
    render(<FieldRow fieldId="tax_id" state={undefined} onChange={vi.fn()} />)
    expect(control(/taxpayer id/i)).toHaveAttribute('type', 'text')
  })

  it('renders a multi-file input for a file field', () => {
    render(<FieldRow fieldId="id_images" state={undefined} onChange={vi.fn()} />)
    const input = control(/photos of your id/i)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('multiple')
  })

  it('renders a select populated from the field\'s own enum', () => {
    render(<FieldRow fieldId="id_form" state={undefined} onChange={vi.fn()} />)
    const select = control(/form of identification/i)
    expect(select.tagName).toBe('SELECT')
    for (const option of ['drivers_license', 'state_id', 'passport']) {
      expect(screen.getByRole('option', { name: option })).toBeInTheDocument()
    }
  })

  it('falls back to a text input for a select-typed field whose schema is not an enum', () => {
    // addr_state is type 'select' but validated as a two-letter string; there
    // is no enumerated list to offer, so inventing one would be a lie.
    render(<FieldRow fieldId="addr_state" state={undefined} onChange={vi.fn()} />)
    expect(control(/^state$/i).tagName).toBe('INPUT')
  })

  it('reports what the user typed to the caller', async () => {
    const onChange = vi.fn()
    render(<FieldRow fieldId="first_name" state={undefined} onChange={onChange} />)
    await userEvent.type(control(/first name/i), 'Ada')
    expect(onChange).toHaveBeenLastCalledWith('first_name', 'Ada')
  })

  it('reports the FULL instance-qualified key, not the bare field id', async () => {
    const onChange = vi.fn()
    render(<FieldRow fieldId="license_number#1" state={undefined} onChange={onChange} />)
    await userEvent.type(control(/license number 2/i), 'GA-SLV-2')
    expect(onChange).toHaveBeenLastCalledWith('license_number#1', 'GA-SLV-2')
  })

  it('gives two licence instances two separate, separately-labelled inputs', async () => {
    const onChange = vi.fn()
    render(
      <>
        <FieldRow fieldId="license_number#0" state={undefined} onChange={onChange} />
        <FieldRow fieldId="license_number#1" state={undefined} onChange={onChange} />
      </>,
    )
    const first = control(/license number 1/i)
    const second = control(/license number 2/i)
    expect(first).not.toBe(second)
    expect(first.id).not.toBe(second.id)

    await userEvent.type(second, 'GA-SLV-2')
    expect(onChange).toHaveBeenLastCalledWith('license_number#1', 'GA-SLV-2')
    expect(onChange).not.toHaveBeenCalledWith('license_number#0', expect.anything())
  })

  it('shows the field\'s own validation message inline when the value is refused', async () => {
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} />)
    await userEvent.type(control(/zip code/i), 'nope')
    expect(await screen.findByRole('alert')).toHaveTextContent(/5-digit ZIP/i)
  })

  it('shows the inline error in the WARNING ORANGE, never the brand red', async () => {
    // Red is IAA's primary. A red error border says "IAA", not "you got this
    // wrong" — every component library defaults destructive to red and this
    // one deliberately does not.
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} />)
    const input = control(/zip code/i)
    await userEvent.type(input, 'nope')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveStyle({ background: COLOR.errorSurface })
    expect(input).toHaveStyle({ border: `1px solid ${COLOR.error}` })

    const rendered = document.body.innerHTML
    expect(rendered).not.toContain(COLOR.primary)
    expect(rendered).not.toContain('rgb(184, 32, 24)')
  })

  it('does not report a value the field schema refuses', async () => {
    const onChange = vi.fn()
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={onChange} />)
    await userEvent.type(control(/zip code/i), 'nope')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps what the user typed on screen even while it is invalid', async () => {
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} />)
    const input = control(/zip code/i)
    await userEvent.type(input, '303')
    expect(input).toHaveValue('303')
  })

  it('does not scold an untouched field', () => {
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('marks an invalid input aria-invalid and points it at the message', async () => {
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} />)
    const input = control(/zip code/i)
    await userEvent.type(input, 'nope')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent(/ZIP/i)
  })

  it('shows a value that already exists in state', () => {
    render(
      <FieldRow
        fieldId="first_name"
        state={{ value: 'Ada', status: 'confirmed' }}
        onChange={vi.fn()}
      />,
    )
    expect(control(/first name/i)).toHaveValue('Ada')
  })

  it('picks up a value carried in from elsewhere after the first render', async () => {
    // A carried business address must appear in the input immediately, not
    // only once the user touches the field.
    const { rerender } = render(
      <FieldRow fieldId="biz_addr_line1" state={undefined} onChange={vi.fn()} />,
    )
    expect(control(/business address/i)).toHaveValue('')

    rerender(
      <FieldRow
        fieldId="biz_addr_line1"
        state={{
          value: '2345 Anywhere St', status: 'derived',
          provenance: { source: 'carried', fromFieldId: 'addr_line1' },
        }}
        onChange={vi.fn()}
      />,
    )
    expect(control(/business address/i)).toHaveValue('2345 Anywhere St')
  })

  it('stores file NAMES for a file field, since phase 1 has no upload', async () => {
    const onChange = vi.fn()
    render(<FieldRow fieldId="id_images" state={undefined} onChange={onChange} />)
    const file = new File(['x'], 'licence-front.png', { type: 'image/png' })
    await userEvent.upload(control(/photos of your id/i), file)
    expect(onChange).toHaveBeenCalledWith('id_images', ['licence-front.png'])
  })

  it('derives the input id from the full requirement key', () => {
    expect(fieldInputId('first_name')).toBe('field-first_name')
    expect(fieldInputId('license_number#0')).toBe('field-license_number--0')
    expect(fieldInputId('license_number#1')).not.toBe(fieldInputId('license_number#0'))
  })

  it('stays read-only when no onChange is supplied', () => {
    render(<FieldRow fieldId="first_name" state={{ value: 'Ada', status: 'confirmed' }} />)
    expect(queryControl(/first name/i)).toBeNull()
    expect(screen.getByText('Ada')).toBeInTheDocument()
  })
})
