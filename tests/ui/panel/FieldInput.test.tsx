import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldRow } from '@/ui/panel/FieldRow'
import { fieldInputId } from '@/ui/panel/FieldControl'
import { COLOR } from '@/ui/theme/tokens'
import type { FieldState } from '@/domain/application/state'

/**
 * The row's wrapper carries `aria-label` too (it is a labelled group), so an
 * unscoped getByLabelText matches both it and the control. Scoping to the
 * form element is what asserts an INPUT exists — the whole point of C4.
 */
const CONTROL = { selector: 'input, select, textarea' } as const
const control = (label: RegExp) => screen.getByLabelText(label, CONTROL)
const queryControl = (label: RegExp) => screen.queryByLabelText(label, CONTROL)

/**
 * Phase 1's exit criterion is that a user can complete a registration
 * through the panel. Before this wave `grep -rnE "<input|<select"` over src/
 * returned nothing at all: the panel could display an application and never
 * accept one.
 */
describe('FieldInput — the panel accepts data', () => {
  it('renders a text input for a text field, labelled by the visible label', () => {
    render(<FieldRow fieldId="first_name" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const input = control(/first name/i)
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'text')
  })

  it('renders a date input for a date field', () => {
    render(<FieldRow fieldId="dob" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(control(/date of birth/i)).toHaveAttribute('type', 'date')
  })

  it('renders a tel input for a phone field', () => {
    render(<FieldRow fieldId="phone_mobile" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(control(/mobile phone/i)).toHaveAttribute('type', 'tel')
  })

  it('renders a text input for a taxpayer ID, not a password field', () => {
    // Hiding what you typed from yourself is how a mistyped SSN gets filed.
    render(<FieldRow fieldId="tax_id" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(control(/taxpayer id/i)).toHaveAttribute('type', 'text')
  })

  it('renders a multi-file input for a file field', () => {
    render(<FieldRow fieldId="id_images" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const input = control(/photos of your id/i)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('multiple')
  })

  it('renders a select populated from the field\'s own enum', () => {
    render(<FieldRow fieldId="license_type" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const select = control(/license type/i)
    expect(select.tagName).toBe('SELECT')
    for (const option of ['dealer', 'dismantler', 'exporter', 'salvage']) {
      expect(screen.getByRole('option', { name: option })).toBeInTheDocument()
    }
  })

  it('gives addr_state a real list, with the name shown and the code stored', () => {
    render(<FieldRow fieldId="addr_state" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const select = control(/^state$/i)
    expect(select.tagName).toBe('SELECT')
    // The DMV's code is what gets stored; the applicant reads the state name.
    const option = screen.getByRole('option', { name: 'Georgia' }) as HTMLOptionElement
    expect(option.value).toBe('GA')
  })

  // The predecessor of this test asserted a hint reading "in your own words —
  // there is no list to pick from", rendered on five fields including the two
  // that ask which state and country issued your ID. Both have real lists;
  // apologising for a missing dropdown on a field that should have one reads
  // as broken software, so the lists were added and the hint deleted.
  it('gives id_country a real list keyed by the code a passport MRZ prints', () => {
    render(<FieldRow fieldId="id_country" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(control(/country that issued/i).tagName).toBe('SELECT')
    const option = screen.getByRole('option', { name: 'Netherlands' }) as HTMLOptionElement
    expect(option.value).toBe('NLD')
  })

  it('leaves a genuinely list-less field as a plain box, with an example, not an apology', () => {
    render(<FieldRow fieldId="primary_activity" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const input = control(/primary activity/i)
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('placeholder')).toBe('Rebuilding and reselling salvage cars')
    expect(screen.queryByText(/in your own words/i)).not.toBeInTheDocument()
  })

  it('offers no such hint where there is a real list to choose from', () => {
    render(<FieldRow fieldId="license_type" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByText(/in your own words/i)).not.toBeInTheDocument()
  })

  it('offers no such hint for a plain text field — it is not news that text is text', () => {
    render(<FieldRow fieldId="first_name" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByText(/in your own words/i)).not.toBeInTheDocument()
  })

  it('reports what the user typed to the caller', async () => {
    const onChange = vi.fn()
    render(<FieldRow fieldId="first_name" state={undefined} onChange={onChange} onClear={vi.fn()} />)
    await userEvent.type(control(/first name/i), 'Ada')
    expect(onChange).toHaveBeenLastCalledWith('first_name', 'Ada')
  })

  it('reports the FULL instance-qualified key, not the bare field id', async () => {
    const onChange = vi.fn()
    render(<FieldRow fieldId="license_number#1" state={undefined} onChange={onChange} onClear={vi.fn()} />)
    await userEvent.type(control(/license number 2/i), 'GA-SLV-2')
    expect(onChange).toHaveBeenLastCalledWith('license_number#1', 'GA-SLV-2')
  })

  it('gives two licence instances two separate, separately-labelled inputs', async () => {
    const onChange = vi.fn()
    render(
      <>
        <FieldRow fieldId="license_number#0" state={undefined} onChange={onChange} onClear={vi.fn()} />
        <FieldRow fieldId="license_number#1" state={undefined} onChange={onChange} onClear={vi.fn()} />
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
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    await userEvent.type(control(/zip code/i), 'nope')
    expect(await screen.findByRole('alert')).toHaveTextContent(/5-digit ZIP/i)
  })

  it('shows the inline error in the WARNING ORANGE, never the brand red', async () => {
    // Red is IAA's primary. A red error border says "IAA", not "you got this
    // wrong" — every component library defaults destructive to red and this
    // one deliberately does not.
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
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
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={onChange} onClear={vi.fn()} />)
    await userEvent.type(control(/zip code/i), 'nope')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps what the user typed on screen even while it is invalid', async () => {
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    const input = control(/zip code/i)
    await userEvent.type(input, '303')
    expect(input).toHaveValue('303')
  })

  it('does not scold an untouched field', () => {
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('marks an invalid input aria-invalid and points it at the message', async () => {
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />)
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
        onChange={vi.fn()} onClear={vi.fn()}
      />,
    )
    expect(control(/first name/i)).toHaveValue('Ada')
  })

  it('picks up a value carried in from elsewhere after the first render', async () => {
    // A carried business address must appear in the input immediately, not
    // only once the user touches the field.
    const { rerender } = render(
      <FieldRow fieldId="biz_addr_line1" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />,
    )
    expect(control(/business address/i)).toHaveValue('')

    rerender(
      <FieldRow
        fieldId="biz_addr_line1"
        state={{
          value: '2345 Anywhere St', status: 'derived',
          provenance: { source: 'carried', fromFieldId: 'addr_line1' },
        }}
        onChange={vi.fn()} onClear={vi.fn()}
      />,
    )
    expect(control(/business address/i)).toHaveValue('2345 Anywhere St')
  })

  it('stores file NAMES for a file field, since phase 1 has no upload', async () => {
    const onChange = vi.fn()
    render(<FieldRow fieldId="id_images" state={undefined} onChange={onChange} onClear={vi.fn()} />)
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

/**
 * F3: "the recorded value must never disagree with what is on screen, and a
 * field whose on-screen text is not a valid value must not count towards
 * done." Before this, FieldInput reported upward only when the schema
 * accepted the draft, so clearing a field or correcting one through an
 * invalid intermediate left the RECORD holding a value the applicant could
 * no longer see — on a surface where they attest to what they submitted.
 */
describe('FieldInput — the record follows the screen', () => {
  const recorded = { value: '30301', status: 'confirmed' } as const

  it('drops the recorded value when the field is cleared', async () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    render(
      <FieldRow
        fieldId="first_name"
        state={{ value: 'Ada', status: 'confirmed' }}
        onChange={onChange}
        onClear={onClear}
      />,
    )
    await userEvent.clear(control(/first name/i))

    expect(onClear).toHaveBeenCalledWith('first_name')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('drops the stale valid value when a correction passes through invalid', async () => {
    // The probe: type 30301, then append 9. The input shows 303019 and the
    // record used to go on holding 30301.
    const onClear = vi.fn()
    render(
      <FieldRow
        fieldId="addr_zip"
        state={recorded}
        onChange={vi.fn()}
        onClear={onClear}
      />,
    )
    await userEvent.type(control(/zip code/i), '9')

    expect(control(/zip code/i)).toHaveValue('303019')
    expect(onClear).toHaveBeenCalledWith('addr_zip')
  })

  it('keeps what the applicant typed when the clear comes back', async () => {
    // The clear echoes back as an empty external value. If that echo reset
    // the draft, the applicant's half-finished correction would vanish from
    // under the caret — a far worse bug than the one being fixed.
    function Harness() {
      const [state, setState] = useState<FieldState | undefined>(recorded)
      return (
        <FieldRow
          fieldId="addr_zip"
          state={state}
          onChange={(_id, value) => setState({ value, status: 'confirmed' })}
          onClear={() => setState({ value: null, status: 'empty' })}
        />
      )
    }
    render(<Harness />)
    await userEvent.type(control(/zip code/i), '9')
    expect(control(/zip code/i)).toHaveValue('303019')

    // ...and a value that becomes valid again is reported normally.
    await userEvent.clear(control(/zip code/i))
    await userEvent.type(control(/zip code/i), '30144')
    expect(control(/zip code/i)).toHaveValue('30144')
  })

  it('does not ask to clear a field that holds nothing to clear', async () => {
    // Typing rubbish into an EMPTY field is not a divergence; there is no
    // record to correct, and a clear per keystroke would be noise in the
    // audit trail.
    const onClear = vi.fn()
    render(<FieldRow fieldId="addr_zip" state={undefined} onChange={vi.fn()} onClear={onClear} />)
    await userEvent.type(control(/zip code/i), 'nope')
    expect(onClear).not.toHaveBeenCalled()
  })

  it('stops asking once the record is actually empty', async () => {
    // A clear per keystroke would fill the audit trail with clears of a field
    // that already holds nothing.
    const onClear = vi.fn()
    function Harness() {
      const [state, setState] = useState<FieldState | undefined>(recorded)
      return (
        <FieldRow
          fieldId="addr_zip"
          state={state}
          onChange={vi.fn()}
          onClear={(id) => { onClear(id); setState({ value: null, status: 'empty' }) }}
        />
      )
    }
    render(<Harness />)
    await userEvent.type(control(/zip code/i), '999')
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('goes read-only if only half the editing contract is supplied', () => {
    // Supplying onChange without onClear would let the record drift again.
    // The type refuses it; this pins the runtime behaviour so a cast cannot
    // quietly produce a field that records values it can never unrecord.
    render(
      // @ts-expect-error onChange and onClear must be supplied together
      <FieldRow fieldId="first_name" state={undefined} onChange={vi.fn()} />,
    )
    expect(queryControl(/first name/i)).toBeNull()
  })
})
