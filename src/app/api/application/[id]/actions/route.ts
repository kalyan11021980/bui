import { NextResponse } from 'next/server'
import {
  actionRequestSchema, describeZodError, toAction,
} from '@/domain/application/action-schema'
import { applyAction } from '@/server/application-service'
import { failure, jsonError } from '@/server/http'
import { ownerTokenOf } from '@/server/ownership'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError(failure('malformed', 'Request body must be valid JSON'))
  }

  const parsed = actionRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(failure('malformed', describeZodError(parsed.error)))
  }

  const result = applyAction(id, ownerTokenOf(request), toAction(parsed.data.action))
  return result.ok ? NextResponse.json(result.value) : jsonError(result.failure)
}
