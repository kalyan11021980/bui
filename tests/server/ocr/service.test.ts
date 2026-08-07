import { describe, expect, it, vi } from 'vitest'
import { envProvider, readDocument } from '@/server/ocr/service'

describe('readDocument', () => {
  it('makes exactly one call and returns its text', async () => {
    const provider = vi.fn(async (_imageBase64: string) => ({ text: 'READ' }))

    const read = await readDocument('base64', provider)
    expect(read.text).toBe('READ')
    expect(provider).toHaveBeenCalledTimes(1)
    expect(provider).toHaveBeenCalledWith('base64')
  })

  it('propagates a failed read', async () => {
    const provider = vi.fn(async () => { throw new Error('server down') })
    await expect(readDocument('base64', provider)).rejects.toThrow('server down')
  })
})

describe('envProvider', () => {
  const set = () => {
    vi.stubEnv('OCR_ENDPOINT', 'https://ocr.test')
    vi.stubEnv('OCR_MODEL', 'some-model')
    vi.stubEnv('OCR_API_KEY', 'some-key')
  }

  it('throws when OCR_ENDPOINT is unset', () => {
    set()
    vi.stubEnv('OCR_ENDPOINT', '')
    expect(() => envProvider()).toThrow(/OCR_ENDPOINT/)
    vi.unstubAllEnvs()
  })

  it('throws when OCR_MODEL is unset', () => {
    set()
    vi.stubEnv('OCR_MODEL', '')
    expect(() => envProvider()).toThrow(/OCR_MODEL/)
    vi.unstubAllEnvs()
  })

  it('throws when OCR_API_KEY is unset', () => {
    set()
    vi.stubEnv('OCR_API_KEY', '')
    expect(() => envProvider()).toThrow(/OCR_API_KEY/)
    vi.unstubAllEnvs()
  })

  it('does not throw when all three are set', () => {
    set()
    expect(() => envProvider()).not.toThrow()
    vi.unstubAllEnvs()
  })
})
