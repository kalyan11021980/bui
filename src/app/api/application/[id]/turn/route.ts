import { NextResponse } from 'next/server'
import { z } from 'zod'
import { uploadedDocTypes } from '@/domain/application/documents'
import { SECTION_ORDER } from '@/domain/orchestrator/plan'
import type { Section } from '@/domain/section'
import { modelForTurn } from '@/server/orchestrator/model-for-turn'
import { applyTurn, getApplication } from '@/server/application-service'
import { failure, jsonError } from '@/server/http'
import { ownerTokenOf } from '@/server/ownership'

type Context = { params: Promise<{ id: string }> }

// Exactly one of text or doneWith; text must not be blank.
const bodySchema = z
  .object({
    text: z.string().optional(),
    doneWith: z.enum([...SECTION_ORDER] as [Section, ...Section[]]).optional(),
  })
  .strict()
  .refine((body) => (body.text !== undefined) !== (body.doneWith !== undefined), {
    message: 'exactly one of text or doneWith',
  })
  .refine((body) => body.text === undefined || body.text.trim() !== '', {
    message: 'text must not be blank',
  })

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
    return jsonError(failure('malformed', 'Malformed turn request'))
  }

  const ownerToken = ownerTokenOf(request)
  // A snapshot ahead of the model call, same as every other TurnInput field —
  // applyTurn already re-reads the record after the await for what it
  // commits, so a document landing mid-call is picked up on the next turn.
  // A failed load answers no documents held; applyTurn repeats the same
  // lookup and returns the real 404/403.
  const loaded = getApplication(id, ownerToken)
  const uploadedDocs = loaded.ok ? uploadedDocTypes(loaded.value) : []

  const result = await applyTurn(id, ownerToken, {
    text: parsed.data.text,
    doneWith: parsed.data.doneWith,
    modelForTurn,
    isResume: false,
    uploadedDocs,
    at: new Date().toISOString(),
  })

  return result.ok ? NextResponse.json(result.value) : jsonError(result.failure)
}
