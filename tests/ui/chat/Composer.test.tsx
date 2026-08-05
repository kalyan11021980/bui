import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from '@/ui/chat/Composer'
import { createApplication, applicationReducer } from '@/domain/application/reducer'
import type { ApplicationState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}
const DEALER_PROFILE: ApplicantProfile = {
  ...PROFILE,
  licenses: ['dealer'],
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
    const input = screen.getByLabelText(/attach a photo of your driver's license/i)
    await userEvent.upload(input, new File(['x'], 'dl.png', { type: 'image/png' }))
    expect(onReadDocument).toHaveBeenCalledWith('drivers_license', IMAGE)
  })

  it('with several outstanding documents, attach opens a chooser', async () => {
    const { onReadDocument } = renderComposer(createApplication('app-1', DEALER_PROFILE, 'o'))
    await userEvent.click(screen.getByRole('button', { name: /attach a document/i }))
    const input = screen.getByLabelText(/photo of your dealer license/i)
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

  it('never carries the disabled attribute, only aria-disabled', () => {
    renderComposer(createApplication('app-1', PROFILE, 'o'), { sendable: false })
    const send = screen.getByRole('button', { name: /send/i })
    expect(send).not.toBeDisabled()
    expect(send).toHaveAttribute('aria-disabled', 'true')
  })
})
