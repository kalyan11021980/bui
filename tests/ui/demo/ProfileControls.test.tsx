import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileControls } from '@/ui/demo/ProfileControls'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const business: ApplicantProfile = {
  applicantType: 'business',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: ['dealer'],
  addressDiffersFromId: false,
}

const individual: ApplicantProfile = { ...business, applicantType: 'individual', licenses: [] }

function setup(profile: ApplicantProfile, disabled = false) {
  const onChange = vi.fn()
  render(<ProfileControls profile={profile} onChange={onChange} disabled={disabled} />)
  return { onChange, user: userEvent.setup() }
}

describe('ProfileControls', () => {
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

  it('disables every control once the application is closed', () => {
    setup(business, true)
    expect(screen.getByLabelText(/applicant/i)).toBeDisabled()
    expect(screen.getByLabelText(/state/i)).toBeDisabled()
    expect(screen.getByLabelText(/gsa/i)).toBeDisabled()
    expect(screen.getByLabelText(/licence/i)).toBeDisabled()
  })

  it('says it is demo scaffolding, not part of the registration', () => {
    // A real applicant never sets these — they are engine inputs.
    setup(business)
    expect(screen.getByRole('group')).toHaveAccessibleName(/demo/i)
  })
})
