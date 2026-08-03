import { describe, expect, it, vi } from 'vitest'
import { envProvider, readDocument } from '@/server/ocr/service'

describe('readDocument', () => {
  it('runs both prompt modes and returns both texts', async () => {
    const provider = vi.fn(async ({ prompt }: { prompt: string }) => ({
      text: prompt.includes('grounding') ? 'GROUNDED' : 'PLAIN',
      detections: [],
    }))

    const read = await readDocument('base64', provider)
    expect(read.text).toBe('GROUNDED')
    expect(read.plainText).toBe('PLAIN')
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('still returns the grounded read when the plain pass fails', async () => {
    // Cross-pass agreement is a bonus signal. Losing it must not lose the read.
    const provider = vi.fn(async ({ prompt }: { prompt: string }) => {
      if (!prompt.includes('grounding')) throw new Error('plain pass died')
      return { text: 'GROUNDED', detections: [] }
    })

    const read = await readDocument('base64', provider)
    expect(read.text).toBe('GROUNDED')
    expect(read.plainText).toBe('')
  })

  it('propagates a failed grounded pass', async () => {
    const provider = vi.fn(async () => { throw new Error('server down') })
    await expect(readDocument('base64', provider)).rejects.toThrow('server down')
  })
})

describe('envProvider', () => {
  it('throws when OCR_ENDPOINT is unset', () => {
    vi.stubEnv('OCR_ENDPOINT', '')
    vi.stubEnv('OCR_MODEL', 'some-model')
    expect(() => envProvider()).toThrow()
    vi.unstubAllEnvs()
  })

  it('throws when OCR_MODEL is unset', () => {
    vi.stubEnv('OCR_ENDPOINT', 'http://localhost:1234')
    vi.stubEnv('OCR_MODEL', '')
    expect(() => envProvider()).toThrow()
    vi.unstubAllEnvs()
  })

  it('does not throw when both are set', () => {
    vi.stubEnv('OCR_ENDPOINT', 'http://localhost:1234')
    vi.stubEnv('OCR_MODEL', 'some-model')
    expect(() => envProvider()).not.toThrow()
    vi.unstubAllEnvs()
  })
})
