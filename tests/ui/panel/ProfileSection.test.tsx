import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSection } from '@/ui/panel/ProfileSection'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const business: ApplicantProfile = {
  applicantType: 'business',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: ['dealer'],
  addressDiffersFromId: false,
  idForm: 'drivers_license',
  bizCountry: null,
}

const individual: ApplicantProfile = { ...business, applicantType: 'individual', licenses: [] }

function setup(profile: ApplicantProfile) {
  const onChange = vi.fn()
  render(<ProfileSection profile={profile} onChange={onChange} />)
  return { onChange, user: userEvent.setup() }
}

describe('ProfileSection', () => {
  it('shows the profile currently driving the requirements', () => {
    setup(business)
    expect(screen.getByLabelText(/applicant/i)).toHaveValue('business')
    expect(screen.getByLabelText(/state/i)).toHaveValue('GA')
    expect(screen.getByLabelText(/gsa/i)).not.toBeChecked()
  })

  it('patches only the field that changed', async () => {
    const { onChange, user } = setup(business)
    await user.selectOptions(screen.getByLabelText(/applicant/i), 'individual')
    expect(onChange).toHaveBeenCalledWith({ applicantType: 'individual' })
  })

  it('reports a state change, including back to not-yet-told', async () => {
    const { onChange, user } = setup(business)
    await user.selectOptions(screen.getByLabelText(/state/i), 'OH')
    expect(onChange).toHaveBeenCalledWith({ state: 'OH' })

    await user.selectOptions(screen.getByLabelText(/state/i), '')
    expect(onChange).toHaveBeenLastCalledWith({ state: null })
  })

  it('toggles GSA', async () => {
    const { onChange, user } = setup(business)
    await user.click(screen.getByLabelText(/gsa/i))
    expect(onChange).toHaveBeenCalledWith({ wantsGsa: true })
  })

  it('reports a change of ID form', async () => {
    const { onChange, user } = setup(business)
    expect(screen.getByLabelText(/id form/i)).toHaveValue('drivers_license')
    await user.selectOptions(screen.getByLabelText(/id form/i), 'passport')
    expect(onChange).toHaveBeenCalledWith({ idForm: 'passport' })
  })

  it('toggles the address-differs-from-ID declaration', async () => {
    // Drives the proof-of-residency requirement.
    const { onChange, user } = setup(business)
    await user.click(screen.getByLabelText(/address differs/i))
    expect(onChange).toHaveBeenCalledWith({ addressDiffersFromId: true })
  })

  it('turns a licence count into that many licence entries', async () => {
    const { onChange, user } = setup(business)
    await user.selectOptions(screen.getByLabelText(/licence/i), '2')
    expect(onChange).toHaveBeenCalledWith({ licenses: ['dealer', 'dealer'] })
  })

  it('offers no licence control to an individual, who is never asked for one', () => {
    setup(individual)
    expect(screen.queryByLabelText(/licence/i)).not.toBeInTheDocument()
  })

  it('falls back to plain text once the application is closed, staying visible but not editable', () => {
    render(<ProfileSection profile={business} />)
    // Still visible: a mistaken answer would otherwise be uncorrectable
    // without starting over, so it must be readable even while closed.
    expect(screen.getByText('Business')).toBeInTheDocument()
    expect(screen.getByText('GA')).toBeInTheDocument()
    expect(screen.getAllByText('No')).toHaveLength(2)
    // Not editable: no control left to drive a change through.
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
