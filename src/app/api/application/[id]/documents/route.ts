import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ALL_DOC_TYPES } from '@/domain/field-id'
import { ingestDocument } from '@/server/document-service'
import { failure, jsonError } from '@/server/http'

type Context = { params: Promise<{ id: string }> }

/**
 * No `imageSize`: the server reads the dimensions off the bytes. It gates the
 * quality band on the width and maps every box through it, so a caller-supplied
 * size decides both and nothing here could tell a wrong one from a right one.
 */
const bodySchema = z
  .object({
    docType: z.enum(ALL_DOC_TYPES),
    imageBase64: z.string().min(1),
  })
  .strict()

export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError(failure('malformed', 'Request body must be valid JSON'))
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(failure('malformed', 'Malformed document upload'))
  }

  // The image is never written anywhere. It lives for this call.
  const result = await ingestDocument({
    applicationId: id,
    docType: parsed.data.docType,
    imageBase64: parsed.data.imageBase64,
    at: new Date().toISOString(),
  })

  return result.ok ? NextResponse.json(result.value) : jsonError(result.failure)
}
