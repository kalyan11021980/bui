import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareImage } from '@/ui/panel/prepare-image'

/**
 * jsdom decodes no images and has no canvas, so the decoder and the canvas are
 * stood in for. What is pinned here is the contract the route and the crops
 * both depend on — oriented pixels, their size, and a bare base64 payload.
 * Whether a real browser honours the EXIF flag is a browser question, and was
 * answered by uploading a rotated photo to a running app.
 */

type FakeBitmap = { width: number; height: number; close: () => void }

function stubBrowser(options: {
  bitmap?: Partial<FakeBitmap>
  context?: unknown
  dataUrl?: string
}) {
  const bitmap: FakeBitmap = {
    width: 1560, height: 1006, close: vi.fn(), ...options.bitmap,
  }
  const calls: { orientation: string | undefined; file: unknown }[] = []
  const drawn: unknown[] = []

  const context = options.context === undefined
    ? { drawImage: (...args: unknown[]) => drawn.push(args) }
    : options.context

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: (mime: string, quality: number) =>
      options.dataUrl ?? `data:${mime};q=${quality};base64,QUJD`,
  }

  vi.stubGlobal('createImageBitmap', async (file: unknown, opts?: ImageBitmapOptions) => {
    calls.push({ orientation: opts?.imageOrientation, file })
    return bitmap
  })
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement)

  return { bitmap, calls, canvas, drawn }
}

const photo = () => new File(['x'], 'card.jpg', { type: 'image/jpeg' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('prepareImage', () => {
  it('decodes in the orientation the photo asks to be displayed in', async () => {
    // A phone photo stores its rotation as a flag. Decoding without it gives
    // sideways pixels and swapped dimensions, and every crop moves.
    const { calls } = stubBrowser({})

    await prepareImage(photo())

    expect(calls).toHaveLength(1)
    expect(calls[0]?.orientation).toBe('from-image')
  })

  it('measures the decoded pixels, and redraws them at that size', async () => {
    const { canvas, drawn } = stubBrowser({ bitmap: { width: 1560, height: 1006 } })

    const prepared = await prepareImage(photo())

    expect(prepared.imageSize).toEqual({ width: 1560, height: 1006 })
    expect([canvas.width, canvas.height]).toEqual([1560, 1006])
    expect(drawn).toHaveLength(1)
  })

  it('hands back the payload without the prefix the route refuses', async () => {
    stubBrowser({ dataUrl: 'data:image/jpeg;base64,QUJD' })

    const prepared = await prepareImage(photo())

    expect(prepared.imageBase64).toBe('QUJD')
    expect(prepared.imageBase64).not.toMatch(/^data:/)
    // The crops clip the same pixels the server measured, not the original file.
    expect(prepared.imageUrl).toBe('data:image/jpeg;base64,QUJD')
  })

  it('releases the decoded bitmap, even when the canvas cannot be had', async () => {
    const { bitmap } = stubBrowser({ context: null })

    await expect(prepareImage(photo())).rejects.toThrow(/cannot open/i)
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })
})
