import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import {
  applicationReducer, createApplication, outstandingFields,
} from '@/domain/application/reducer'
import { requiredFields } from '@/domain/requirements/engine'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const AT = '2026-08-01T12:00:00.000Z'
const profile: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA',
  wantsGsa: false, licenses: [],
}

describe('ApplicationPanel', () => {
  it('shows how many fields are left', () => {
    const s = createApplication('app-1', profile)
    render(<ApplicationPanel state={s} />)
    const total = outstandingFields(s).length
    expect(screen.getByText(new RegExp(`0 of ${total}`))).toBeInTheDocument()
  })

  it('renders a row for every required field, not just the outstanding ones', () => {
    // On a fresh application, outstanding === required, so asserting against
    // outstandingFields() couldn't distinguish "renders every required field"
    // from a bug that rendered only the outstanding ones. Completing one
    // field makes the two counts diverge — a satisfied field must still be
    // visible and revisitable, not disappear from the panel.
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(outstandingFields(s).length).toBeLessThan(requiredFields(s.profile).length)
    render(<ApplicationPanel state={s} />)
    expect(screen.getAllByRole('group')).toHaveLength(requiredFields(s.profile).length)
  })

  it('never disables the submit button — it explains instead', () => {
    const s = createApplication('app-1', profile)
    render(<ApplicationPanel state={s} />)
    const btn = screen.getByRole('button', { name: /submit/i })
    expect(btn).not.toBeDisabled()
    expect(screen.getByText(/left to go/i)).toBeInTheDocument()
  })

  it('reports progress as fields are completed', () => {
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    render(<ApplicationPanel state={s} />)
    expect(screen.getByText(/^1 of /)).toBeInTheDocument()
  })

  it('passes a confirm through to the caller', async () => {
    const onConfirm = vi.fn()
    let s = createApplication('app-1', profile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT,
    })
    render(<ApplicationPanel state={s} onConfirm={onConfirm} />)
    await userEvent.click(
      screen.getAllByRole('button', { name: /looks right/i })[0]!,
    )
    expect(onConfirm).toHaveBeenCalledWith('first_name')
  })

  it('calls onSubmit when everything is done', async () => {
    const onSubmit = vi.fn()
    let s = createApplication('app-1', profile)
    for (const id of outstandingFields(s)) {
      s = applicationReducer(s, {
        type: 'SET_VALUE', fieldId: id, value: 'x', source: 'user', at: AT,
      })
    }
    render(<ApplicationPanel state={s} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('renders a distinct row per licence instance and confirms the right one', async () => {
    // A business holding two licences owes `license_number#0` and
    // `license_number#1` — two separate rows, not one shared row. Confirming
    // the second must not silently confirm the first.
    const onConfirm = vi.fn()
    const bizProfile: ApplicantProfile = {
      applicantType: 'business', country: 'US', state: 'GA',
      wantsGsa: false, licenses: ['dealer', 'salvage'],
    }
    let s = createApplication('app-2', bizProfile)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'license_number#0', value: 'GA-DLR-1',
      source: 'ocr', at: AT,
    })
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'license_number#1', value: 'GA-SLV-2',
      source: 'ocr', at: AT,
    })
    render(<ApplicationPanel state={s} onConfirm={onConfirm} />)

    // Each instance gets a distinct, numbered accessible name (License
    // number 1 / License number 2) — not a shared "License number" name,
    // and not the unrelated "Driver's license number" (dl_number).
    const firstRow = screen.getByRole('group', { name: /^license number 1$/i })
    const secondRow = screen.getByRole('group', { name: /^license number 2$/i })
    expect(firstRow).toBeInTheDocument()
    expect(secondRow).toBeInTheDocument()

    // Click "Looks right" within the second licence row specifically, so a
    // bug that always confirms the first instance would be caught.
    await userEvent.click(within(secondRow).getByRole('button', { name: /looks right/i }))
    expect(onConfirm).toHaveBeenCalledWith('license_number#1')
  })
})
