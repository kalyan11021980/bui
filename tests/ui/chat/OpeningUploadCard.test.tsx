import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OpeningUploadCard } from '@/ui/chat/OpeningUploadCard'
import { createApplication, applicationReducer } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}

/* 1600px ≥ CROP_FLOOR_PX, so the band is 'full' and no notice shows. */
const IMAGE: PreparedImage = {
  imageBase64: 'aGk=', imageUrl: 'data:image/png;base64,aGk=',
  imageSize: { width: 1600, height: 1000 },
}
const prepare = async () => IMAGE

describe('OpeningUploadCard', () => {
  it('offers the license upload before anything else happens, and routes the photo', async () => {
    const onReadDocument = vi.fn()
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<OpeningUploadCard state={state} onReadDocument={onReadDocument} prepare={prepare} />)

    const input = screen.getByLabelText(/upload photo/i)
    await userEvent.upload(input, new File(['x'], 'dl.png', { type: 'image/png' }))

    expect(onReadDocument).toHaveBeenCalledWith('drivers_license', IMAGE)
  })

  it('routes a dropped photo the same way as a picked one', async () => {
    const onReadDocument = vi.fn()
    const state = createApplication('app-1', PROFILE, 'owner-1')
    const { container } = render(
      <OpeningUploadCard state={state} onReadDocument={onReadDocument} prepare={prepare} />,
    )

    const card = container.firstElementChild as HTMLElement
    const file = new File(['x'], 'dl.png', { type: 'image/png' })
    fireEvent.drop(card, { dataTransfer: { files: [file] } })

    await waitFor(() =>
      expect(onReadDocument).toHaveBeenCalledWith('drivers_license', IMAGE))
  })

  it('leaves the applicant a spoken way out', () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    render(<OpeningUploadCard state={state} onReadDocument={vi.fn()} prepare={prepare} />)
    expect(screen.getByText(/or just answer in chat/i)).toBeInTheDocument()
  })

  it('is gone once a document of that type has been read', () => {
    const base = createApplication('app-1', PROFILE, 'owner-1')
    const state = applicationReducer(base, {
      type: 'RECORD_DOCUMENT', documentId: 'doc-1',
      docType: 'drivers_license', at: '2026-08-05T00:00:00.000Z',
    })
    const { container } = render(
      <OpeningUploadCard state={state} onReadDocument={vi.fn()} prepare={prepare} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
