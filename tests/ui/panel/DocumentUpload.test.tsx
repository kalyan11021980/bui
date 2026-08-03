import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DocumentUpload } from '@/ui/panel/DocumentUpload'
import type { PreparedImage } from '@/ui/panel/prepare-image'

/**
 * jsdom decodes no images and has no canvas, so the preparation step is
 * injected. It is one seam and not two: the bytes that go up and the size the
 * crops are drawn against come out of the same re-encode, and a test that
 * could stub the size alone could pass while they disagreed.
 */
const prepared = (width: number, height: number): PreparedImage => ({
  imageBase64: 'aW1hZ2UtYnl0ZXM=',
  imageUrl: 'blob:prepared-card',
  imageSize: { width, height },
})

const prepare = (width: number, height: number) => async () => prepared(width, height)

const photo = () => new File(['x'], 'card.png', { type: 'image/png' })

describe('DocumentUpload', () => {
  it('asks for the document by name, not by file type', () => {
    render(<DocumentUpload docType="drivers_license" onRead={vi.fn()} />)
    expect(screen.getByLabelText(/photo of your driver.s license/i)).toBeInTheDocument()
  })

  it('asks for the document the applicant said they hold', () => {
    render(<DocumentUpload docType="passport" onRead={vi.fn()} />)
    expect(screen.getByLabelText(/photo of your passport/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/driver.s license/i)).not.toBeInTheDocument()
  })

  it('says what a good photo looks like before one is taken', () => {
    render(<DocumentUpload docType="drivers_license" onRead={vi.fn()} />)
    expect(screen.getByText(/fill the frame/i)).toBeInTheDocument()
  })

  it('asks for another photo when the image is below the read floor', async () => {
    const onRead = vi.fn()
    render(
      <DocumentUpload docType="drivers_license" onRead={onRead} prepare={prepare(320, 200)} />,
    )

    await userEvent.upload(screen.getByLabelText(/photo of your/i), photo())

    expect(await screen.findByRole('status')).toHaveTextContent(/too small to read/i)
    expect(onRead).not.toHaveBeenCalled()
  })

  it('accepts a large enough image and hands up the bytes it measured', async () => {
    const onRead = vi.fn()
    render(
      <DocumentUpload docType="drivers_license" onRead={onRead} prepare={prepare(1600, 1000)} />,
    )

    await userEvent.upload(screen.getByLabelText(/photo of your/i), photo())

    // The whole prepared image, not the original file: the crops are drawn
    // against these dimensions and the server measures these bytes.
    await vi.waitFor(() => expect(onRead).toHaveBeenCalledTimes(1))
    expect(onRead).toHaveBeenCalledWith(prepared(1600, 1000))
  })

  it('warns without blocking in the band that reads but cannot crop', async () => {
    const onRead = vi.fn()
    render(
      <DocumentUpload docType="drivers_license" onRead={onRead} prepare={prepare(600, 380)} />,
    )

    await userEvent.upload(screen.getByLabelText(/photo of your/i), photo())

    await vi.waitFor(() => expect(onRead).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent(/read it, but/i)
  })

  it('takes back the re-take message once a good photo replaces the bad one', async () => {
    // A notice left over from the previous photo describes the wrong one.
    const onRead = vi.fn()
    const prepare = vi
      .fn<() => Promise<PreparedImage>>()
      .mockResolvedValueOnce(prepared(320, 200))
      .mockResolvedValueOnce(prepared(1600, 1000))

    render(<DocumentUpload docType="drivers_license" onRead={onRead} prepare={prepare} />)
    const input = screen.getByLabelText(/photo of your/i)

    await userEvent.upload(input, photo())
    expect(await screen.findByRole('status')).toHaveTextContent(/too small to read/i)

    await userEvent.upload(input, new File(['y'], 'better.png', { type: 'image/png' }))

    await vi.waitFor(() => expect(onRead).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says so plainly when the photo cannot be opened at all', async () => {
    const onRead = vi.fn()
    render(
      <DocumentUpload
        docType="drivers_license"
        onRead={onRead}
        prepare={async () => { throw new Error('no decoder') }}
      />,
    )

    await userEvent.upload(screen.getByLabelText(/photo of your/i), photo())

    expect(await screen.findByRole('status')).toHaveTextContent(/could not open/i)
    expect(onRead).not.toHaveBeenCalled()
  })

  it('stops offering an upload once the application is closed', () => {
    render(<DocumentUpload docType="drivers_license" onRead={vi.fn()} disabled />)
    expect(screen.getByLabelText(/photo of your/i)).toBeDisabled()
  })
})
