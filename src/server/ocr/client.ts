import { parseGrounding, type Detection } from '@/domain/ocr/grounding'

/**
 * Transport for DeepSeek-OCR behind an OpenAI-compatible server (LM Studio).
 * Parsing lives in `@/domain/ocr/grounding`.
 */

/**
 * Prefer this. Plain OCR silently drops whole fields — measured 2026-08-02, it
 * omitted an entire date row the grounded prompt read fine. Costs ~4x tokens.
 */
export const GROUNDED_PROMPT = '<|grounding|>OCR this image.'
export const PLAIN_PROMPT = 'Free OCR.'

export type OcrRequest = {
  readonly endpoint: string
  readonly model: string
  /** Base64 payload only — no `data:` prefix. */
  readonly imageBase64: string
  readonly imageMediaType?: string
  readonly prompt?: string
  readonly maxTokens?: number
  readonly signal?: AbortSignal
}

export type OcrResult = {
  readonly text: string
  readonly detections: readonly Detection[]
  readonly completionTokens: number | null
}

export class OcrError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'OcrError'
  }
}

type ChatCompletion = {
  choices?: { message?: { content?: string } }[]
  usage?: { completion_tokens?: number }
}

/**
 * Never put an `<image>` token in the prompt text — the server inserts one per
 * attachment, and a second makes the counts disagree. It 400s blaming the image.
 */
export async function requestOcr(request: OcrRequest): Promise<OcrResult> {
  const {
    endpoint, model, imageBase64,
    imageMediaType = 'image/png',
    prompt = GROUNDED_PROMPT,
    maxTokens = 4096,
    signal,
  } = request

  const response = await fetch(`${endpoint.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${imageMediaType};base64,${imageBase64}` },
          },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: maxTokens,
      // Same card in, same reading out — an applicant confirms what they saw.
      temperature: 0,
    }),
    ...(signal ? { signal } : {}),
  })

  if (!response.ok) {
    throw new OcrError(
      `OCR request failed: ${response.status} ${(await response.text()).slice(0, 400)}`,
      response.status,
    )
  }

  const payload = (await response.json()) as ChatCompletion
  const text = payload.choices?.[0]?.message?.content
  if (typeof text !== 'string') {
    throw new OcrError('OCR response contained no message content')
  }

  return {
    text,
    detections: parseGrounding(text),
    completionTokens: payload.usage?.completion_tokens ?? null,
  }
}
