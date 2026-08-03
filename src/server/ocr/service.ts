import { GROUNDED_PROMPT, PLAIN_PROMPT, requestOcr } from './client'
import type { Detection } from '@/domain/ocr/grounding'

export type OcrProvider = (request: {
  readonly imageBase64: string
  readonly prompt: string
}) => Promise<{ readonly text: string; readonly detections: readonly Detection[] }>

export type DocumentRead = {
  readonly text: string
  readonly plainText: string
  readonly detections: readonly Detection[]
}

/** No defaults: a wrong endpoint that silently works is worse than a throw. */
export function envProvider(): OcrProvider {
  const endpoint = process.env.OCR_ENDPOINT
  const model = process.env.OCR_MODEL
  if (!endpoint || !model) {
    throw new Error('OCR_ENDPOINT and OCR_MODEL must both be set')
  }
  return ({ imageBase64, prompt }) => requestOcr({ endpoint, model, imageBase64, prompt })
}

export async function readDocument(
  imageBase64: string,
  provider: OcrProvider = envProvider(),
): Promise<DocumentRead> {
  const grounded = await provider({ imageBase64, prompt: GROUNDED_PROMPT })

  // The plain pass only feeds cross-pass agreement. It is allowed to fail.
  let plainText = ''
  try {
    plainText = (await provider({ imageBase64, prompt: PLAIN_PROMPT })).text
  } catch {
    plainText = ''
  }

  return { text: grounded.text, plainText, detections: grounded.detections }
}
