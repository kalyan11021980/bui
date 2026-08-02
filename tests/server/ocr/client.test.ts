import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  requestOcr,
  OcrError,
  GROUNDED_PROMPT,
} from '@/server/ocr/client'

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

const completion = (content: string) => ({
  choices: [{ message: { content } }],
  usage: { completion_tokens: 42 },
})

const sent = (mock: { mock: { calls: unknown[][] } }) => {
  const [url, init] = mock.mock.calls[0] as FetchArgs
  return { url, body: JSON.parse(String(init.body)) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestOcr', () => {
  it('returns the text and its parsed detections', async () => {
    stubFetch(completion('<|ref|>JONES<|/ref|><|det|>[[1, 2, 3, 4]]<|/det|>'))

    const result = await requestOcr({
      endpoint: 'http://host:1234', model: 'deepseek-ocr', imageBase64: 'AAAA',
    })

    expect(result.detections).toEqual([{ text: 'JONES', box: [1, 2, 3, 4] }])
    expect(result.completionTokens).toBe(42)
  })

  it('never puts an <image> token in the prompt text', async () => {
    // The server inserts one per attachment. A second makes the counts
    // disagree and it answers 400 blaming the image.
    const mock = stubFetch(completion('ok'))
    await requestOcr({
      endpoint: 'http://host:1234', model: 'm', imageBase64: 'AAAA',
    })

    const { body } = sent(mock)
    const parts = body.messages[0].content
    expect(parts.find((p: { type: string }) => p.type === 'text').text)
      .toBe(GROUNDED_PROMPT)
    expect(JSON.stringify(body)).not.toContain('<image>')
  })

  it('sends the image as a data URI and asks for a deterministic reading', async () => {
    const mock = stubFetch(completion('ok'))
    await requestOcr({
      endpoint: 'http://host:1234', model: 'm', imageBase64: 'AAAA',
      imageMediaType: 'image/jpeg',
    })

    const { body } = sent(mock)
    expect(body.messages[0].content[0].image_url.url)
      .toBe('data:image/jpeg;base64,AAAA')
    expect(body.temperature).toBe(0)
  })

  it('does not double the slash on an endpoint given with a trailing one', async () => {
    const mock = stubFetch(completion('ok'))
    await requestOcr({
      endpoint: 'http://host:1234/', model: 'm', imageBase64: 'AAAA',
    })
    expect(sent(mock).url).toBe('http://host:1234/v1/chat/completions')
  })

  it('raises the server status on a failure, so 400 is distinguishable', async () => {
    stubFetch({ error: 'image tokens 2 != 1' }, false, 400)
    await expect(requestOcr({
      endpoint: 'http://host:1234', model: 'm', imageBase64: 'AAAA',
    })).rejects.toMatchObject({ name: 'OcrError', status: 400 })
  })

  it('refuses a well-formed response carrying no content', async () => {
    stubFetch({ choices: [{}] })
    await expect(requestOcr({
      endpoint: 'http://host:1234', model: 'm', imageBase64: 'AAAA',
    })).rejects.toBeInstanceOf(OcrError)
  })

  it('reports no token count rather than zero when usage is absent', async () => {
    // Zero would read as "the model produced nothing", which is a different
    // claim from "the server did not say".
    stubFetch({ choices: [{ message: { content: 'x' } }] })
    const result = await requestOcr({
      endpoint: 'http://host:1234', model: 'm', imageBase64: 'AAAA',
    })
    expect(result.completionTokens).toBeNull()
  })
})
