import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StartScreen } from '@/ui/chat/StartScreen'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

const props = {
  fieldIds: ['first_name', 'last_name', 'email'] as const,
  disabled: false,
  onPick: vi.fn(),
  onReadDocument: vi.fn(),
  readingDocTypes: [] as const,
}

describe('StartScreen', () => {
  it('greets with the vetted headline and offers the license card', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} />)

    expect(screen.getByRole('heading', { name: /set up to bid at IAA/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/upload photo/i)).toBeInTheDocument()
  })

  it('offers at most three things to say, and sends a picked one as intent', async () => {
    const onPick = vi.fn()
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} onPick={onPick} />)

    const cards = screen.getAllByRole('button', { name: /why do you|what else/i })
    expect(cards.length).toBeLessThanOrEqual(3)

    await userEvent.click(screen.getByRole('button', { name: /what else do you need/i }))
    expect(onPick).toHaveBeenCalledWith('What else do you need?')
  })

  it('hides the suggestion cards while sending is unavailable', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} disabled />)

    expect(screen.queryByRole('button', { name: /what else do you need/i })).toBeNull()
    expect(screen.getByLabelText(/upload photo/i)).toBeInTheDocument()
  })
})
