import { NextResponse } from 'next/server'
import { z } from 'zod'
import { modelForTurn } from '@/server/orchestrator/model-for-turn'
import { applyTurn } from '@/server/application-service'
import { failure, jsonError } from '@/server/http'
import { ownerTokenOf } from '@/server/ownership'

type Context = { params: Promise<{ id: string }> }

const bodySchema = z.object({ text: z.string().optional() }).strict()

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

  const result = await applyTurn(id, ownerTokenOf(request), {
    text: parsed.data.text,
    modelForTurn,
    isResume: false,
    uploadedDocs: [],
    at: new Date().toISOString(),
  })

  return result.ok ? NextResponse.json(result.value) : jsonError(result.failure)
}
