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
  currentField: 'first_name' as const,
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

    const cards = screen.getAllByRole('button', { name: /why do you|next step|how much/i })
    expect(cards.length).toBeLessThanOrEqual(3)

    await userEvent.click(screen.getByRole('button', { name: /next step/i }))
    expect(onPick).toHaveBeenCalledWith('What’s my next step?')
  })

  it('hides the suggestion cards while sending is unavailable', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} disabled />)

    expect(screen.queryByRole('button', { name: /next step/i })).toBeNull()
    expect(screen.getByLabelText(/upload photo/i)).toBeInTheDocument()
  })

  it('positions the upload card before suggestion cards in DOM order', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<StartScreen state={state} {...props} />)

    const uploadLabel = screen.getByLabelText(/upload photo/i)
    const uploadCard = uploadLabel.closest('div[class*="rounded-xl"]')!

    const suggestionButton = screen.getByRole('button', { name: /next step/i })

    const position = uploadCard.compareDocumentPosition(suggestionButton)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('applies start-hero view-transition name to wrapper', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    const { container } = render(<StartScreen state={state} {...props} />)

    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.viewTransitionName).toBe('start-hero')
  })
})
