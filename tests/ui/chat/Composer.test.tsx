import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from '@/ui/chat/Composer'
import { outstandingFields } from '@/domain/application/queries'
import { createApplication, applicationReducer } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}
const DEALER_PROFILE: ApplicantProfile = {
  ...PROFILE,
  licenses: ['dealer'],
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

const IMAGE: PreparedImage = {
  imageBase64: 'aGk=', imageUrl: 'data:image/png;base64,aGk=',
  imageSize: { width: 1600, height: 1000 },
}
const prepare = async () => IMAGE

function renderComposer(state: ApplicationState, over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    sendable: true, onSend: vi.fn(), onReadDocument: vi.fn(), state, prepare,
    ...over,
  }
  render(<Composer {...props} />)
  return props
}

describe('Composer', () => {
  it('sends trimmed text and clears the draft', async () => {
    const { onSend } = renderComposer(createApplication('app-1', PROFILE, 'o'))
    const input = screen.getByLabelText(/tell the agent something/i)
    await userEvent.type(input, '  hello  ')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(input).toHaveValue('')
  })

  it('with one outstanding document, attach is a direct file input that routes it', async () => {
    const { onReadDocument } = renderComposer(createApplication('app-1', PROFILE, 'o'))
    // Both the label and the input now carry this aria-label (Chrome does
    // not propagate a label's aria-label to its input), so the query is
    // ambiguous without pinning it to the actual file input.
    const input = screen.getByLabelText(/attach a photo of your driver's license/i, { selector: 'input' })
    await userEvent.upload(input, new File(['x'], 'dl.png', { type: 'image/png' }))
    expect(onReadDocument).toHaveBeenCalledWith('drivers_license', IMAGE)
  })

  it('with several outstanding documents, attach opens a chooser', async () => {
    const { onReadDocument } = renderComposer(createApplication('app-1', DEALER_PROFILE, 'o'))
    await userEvent.click(screen.getByRole('button', { name: /attach a document/i }))
    const input = screen.getByLabelText(/attach a photo of your dealer license/i, { selector: 'input' })
    await userEvent.upload(input, new File(['x'], 'dealer.png', { type: 'image/png' }))
    expect(onReadDocument).toHaveBeenCalledWith('dealer_license', IMAGE)
  })

  it('hides attach entirely once every document is read', () => {
    const base = createApplication('app-1', PROFILE, 'o')
    const state = applicationReducer(base, {
      type: 'RECORD_DOCUMENT', documentId: 'doc-1',
      docType: 'drivers_license', at: '2026-08-05T00:00:00.000Z',
    })
    renderComposer(state)
    expect(screen.queryByLabelText(/attach/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull()
  })

  it('hides attach once submitted, even with a document type still un-read', () => {
    // SUBMIT only checks outstandingFields, not documents — a driver's
    // license photo can be left un-taken while every typed field is filled
    // in. The attach control must not survive submission to accept it.
    const AT = '2026-08-05T00:00:00.000Z'
    let state = createApplication('app-1', PROFILE, 'o')
    for (const id of outstandingFields(state)) {
      state = applicationReducer(state, {
        type: 'SET_VALUE', fieldId: id, value: valueFor(id, state.profile, 'x'), source: 'user', at: AT,
      })
    }
    state = applicationReducer(state, { type: 'SUBMIT', at: AT })

    renderComposer(state)
    expect(screen.queryByLabelText(/attach/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /attach/i })).toBeNull()
  })

  it('never carries the disabled attribute, only aria-disabled', () => {
    renderComposer(createApplication('app-1', PROFILE, 'o'), { sendable: false })
    const send = screen.getByRole('button', { name: /send/i })
    expect(send).not.toBeDisabled()
    expect(send).toHaveAttribute('aria-disabled', 'true')
  })

  it('grows to the hero size on request, docked by default', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    const { container, rerender } = render(
      <Composer sendable onSend={vi.fn()} state={state} onReadDocument={vi.fn()} />,
    )
    expect(container.querySelector('form')?.className).toContain('rounded-2xl')

    rerender(
      <Composer sendable onSend={vi.fn()} state={state} onReadDocument={vi.fn()} size="hero" />,
    )
    expect(container.querySelector('form')?.className).toContain('rounded-3xl')
  })
})
