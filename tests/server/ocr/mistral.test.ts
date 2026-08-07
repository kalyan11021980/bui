import { describe, it, expect, vi, afterEach } from 'vitest'
import { OcrError } from '@/server/ocr/client'
import { requestMistralOcr } from '@/server/ocr/mistral'

type FetchArgs = [string, RequestInit]

function stubFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const pages = (...markdowns: string[]) => ({
  pages: markdowns.map((markdown) => ({ markdown })),
})

const sent = (mock: { mock: { calls: unknown[][] } }) => {
  const [url, init] = mock.mock.calls[0] as FetchArgs
  return { url, init, body: JSON.parse(String(init.body)) }
}

const req = {
  endpoint: 'https://ocr.test',
  model: 'mistral-ocr-4-0',
  apiKey: 'key-123',
  imageBase64: 'AAAA',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestMistralOcr', () => {
  it('posts to the Azure Mistral OCR path', async () => {
    const mock = stubFetch(pages('ok'))
    await requestMistralOcr(req)
    expect(sent(mock).url).toBe('https://ocr.test/providers/mistral/azure/ocr')
  })

  it('does not double the slash on an endpoint given with a trailing one', async () => {
    const mock = stubFetch(pages('ok'))
    await requestMistralOcr({ ...req, endpoint: 'https://ocr.test/' })
    expect(sent(mock).url).toBe('https://ocr.test/providers/mistral/azure/ocr')
  })

  it('sends the key as a Bearer token', async () => {
    const mock = stubFetch(pages('ok'))
    await requestMistralOcr(req)
    const headers = sent(mock).init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer key-123')
  })

  it('sends an image as an image_url data URI', async () => {
    const mock = stubFetch(pages('ok'))
    await requestMistralOcr({ ...req, imageMediaType: 'image/png' })

    const { body } = sent(mock)
    expect(body.document).toEqual({
      type: 'image_url',
      image_url: 'data:image/png;base64,AAAA',
    })
    expect(body.model).toBe('mistral-ocr-4-0')
    // Crops are cut from the original upload, never from embedded images.
    expect(body.include_image_base64).toBe(false)
  })

  it('sends a PDF as a document_url', async () => {
    const mock = stubFetch(pages('ok'))
    await requestMistralOcr({ ...req, imageMediaType: 'application/pdf' })

    expect(sent(mock).body.document).toEqual({
      type: 'document_url',
      document_url: 'data:application/pdf;base64,AAAA',
    })
  })

  it('joins the markdown of every page', async () => {
    stubFetch(pages('page one', 'page two'))
    const result = await requestMistralOcr(req)
    expect(result.text).toBe('page one\n\npage two')
  })

  it('raises the server status on a failure, so 401 is distinguishable', async () => {
    stubFetch({ error: 'unauthorized' }, false, 401)
    await expect(requestMistralOcr(req))
      .rejects.toMatchObject({ name: 'OcrError', status: 401 })
  })

  it('refuses a well-formed response carrying no markdown', async () => {
    stubFetch({ pages: [{}] })
    await expect(requestMistralOcr(req)).rejects.toBeInstanceOf(OcrError)
  })
})
