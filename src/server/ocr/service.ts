import { requestMistralOcr } from './mistral'

export type OcrProvider = (imageBase64: string) => Promise<{
  readonly text: string
}>

export type DocumentRead = {
  readonly text: string
}

/** No defaults: a wrong endpoint that silently works is worse than a throw. */
export function envProvider(): OcrProvider {
  const endpoint = process.env.OCR_ENDPOINT
  const model = process.env.OCR_MODEL
  const apiKey = process.env.OCR_API_KEY
  if (!endpoint || !model || !apiKey) {
    throw new Error('OCR_ENDPOINT, OCR_MODEL and OCR_API_KEY must all be set')
  }
  return async (imageBase64) => {
    const { text } = await requestMistralOcr({ endpoint, model, apiKey, imageBase64 })
    // Mistral OCR returns markdown without bounding boxes.
    return { text }
  }
}

export async function readDocument(
  imageBase64: string,
  provider: OcrProvider = envProvider(),
): Promise<DocumentRead> {
  // One read: the document is read into markdown once, deterministically.
  return provider(imageBase64)
}