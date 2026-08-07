import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldInput } from '@/ui/panel/FieldInput'
import { fieldDef } from '@/domain/catalog'
import { vettedCopy } from '@/domain/orchestrator/copy'

describe('multiselect', () => {
  it('dispatches the growing array and clears when emptied', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    render(
      <FieldInput
        fieldId="licenses_held" def={fieldDef('licenses_held')}
        state={undefined} onChange={onChange} onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByLabelText('Dealer'))
    expect(onChange).toHaveBeenCalledWith('licenses_held', ['dealer'])
  })

  it('unchecking the last option clears the field', () => {
    const onChange = vi.fn()
    const onClear = vi.fn()
    render(
      <FieldInput
        fieldId="licenses_held" def={fieldDef('licenses_held')}
        state={{ value: ['dealer'], status: 'confirmed' }}
        onChange={onChange} onClear={onClear}
      />,
    )
    fireEvent.click(screen.getByLabelText('Dealer'))
    expect(onClear).toHaveBeenCalledWith('licenses_held')
  })
})

describe('attest', () => {
  it('shows the certification text above the input', () => {
    render(
      <FieldInput
        fieldId="tax_certification" def={fieldDef('tax_certification')}
        state={undefined} onChange={vi.fn()} onClear={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/Under penalties of perjury/, { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
