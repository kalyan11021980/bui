import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompletionCard } from '@/ui/chat/CompletionCard'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import { vettedCopy } from '@/domain/orchestrator/copy'
import type { ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const AT = '2026-08-05T00:00:00.000Z'
const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

/**
 * A bridged field now feeds SET_VALUE back into the profile, so a blanket
 * 'x' can corrupt it (e.g. id_form: 'x' has no ID_NUMBER entry). Bridged
 * fields get a value that keeps the profile as it already is.
 */
function valueFor(id: string, current: ApplicantProfile, fallback: string): unknown {
  switch (id) {
    case 'applicant_type': return current.applicantType
    case 'location_country': return current.country
    case 'location_state': return current.state
    case 'id_form': return current.idForm
    case 'address_differs': return current.addressDiffersFromId ? 'yes' : 'no'
    case 'wants_gsa': return current.wantsGsa ? 'yes' : 'no'
    case 'licenses_held': return current.licenses
    case 'biz_country': return current.bizCountry
    default: return fallback
  }
}

function answered(): ApplicationState {
  let state = createApplication('app-1', PROFILE, 'o')
  for (const id of outstandingFields(state)) {
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: id, value: valueFor(id, state.profile, 'x'), source: 'user', at: AT,
    })
  }
  return state
}

describe('CompletionCard', () => {
  it('renders nothing while anything is still outstanding', () => {
    const state = createApplication('app-1', PROFILE, 'o')
    const { container } = render(<CompletionCard state={state} onSubmit={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers to send for review once everything is answered, and the button submits', async () => {
    const onSubmit = vi.fn()
    render(<CompletionCard state={answered()} onSubmit={onSubmit} />)
    expect(screen.getByText(vettedCopy('completion_ready'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /send for review/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('is gone once submitted', () => {
    const state = applicationReducer(answered(), { type: 'SUBMIT', at: AT })
    const { container } = render(<CompletionCard state={state} onSubmit={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
