import { NextResponse } from 'next/server'
import { getApplication } from '@/server/application-service'
import { jsonError } from '@/server/http'
import { ownerTokenOf } from '@/server/ownership'

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  const result = getApplication(id, ownerTokenOf(request))
  return result.ok ? NextResponse.json(result.value) : jsonError(result.failure)
}
