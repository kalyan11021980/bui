import { OcrError } from './client'

/**
 * Transport for Mistral OCR (mistral-ocr-4-0) at an Azure AI Foundry
 * endpoint. Mistral OCR returns one markdown string per page and no bounding
 * boxes — field extraction from that markdown lives in `./llm-extract`.
 */

export type MistralOcrRequest = {
  readonly endpoint: string
  readonly model: string
  readonly apiKey: string
  /** Base64 payload only — no `data:` prefix. */
  readonly imageBase64: string
  readonly imageMediaType?: string
  readonly signal?: AbortSignal
}

type OcrResponse = {
  pages?: { markdown?: string }[]
}

export async function requestMistralOcr(
  request: MistralOcrRequest,
): Promise<{ text: string }> {
  const {
    endpoint, model, apiKey, imageBase64,
    imageMediaType = 'image/png',
    signal,
  } = request

  const dataUrl = `data:${imageMediaType};base64,${imageBase64}`
  const document = imageMediaType === 'application/pdf'
    ? { type: 'document_url', document_url: dataUrl }
    : { type: 'image_url', image_url: dataUrl }

  const response = await fetch(
    `${endpoint.replace(/\/+$/, '')}/providers/mistral/azure/ocr`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        document,
        // The pipeline cuts crops from the original upload, never from
        // Mistral's embedded images — so none are asked back.
        include_image_base64: false,
      }),
      ...(signal ? { signal } : {}),
    },
  )

  if (!response.ok) {
    throw new OcrError(
      `OCR request failed: ${response.status} ${(await response.text()).slice(0, 400)}`,
      response.status,
    )
  }

  const payload = (await response.json()) as OcrResponse
  const markdowns = (payload.pages ?? [])
    .map((p) => p.markdown)
    .filter((m): m is string => typeof m === 'string' && m !== '')

  if (markdowns.length === 0) {
    throw new OcrError('OCR response contained no markdown content')
  }

  return { text: markdowns.join('\n\n') }
}
