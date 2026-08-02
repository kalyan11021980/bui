import { NextResponse } from 'next/server'
import { getApplication } from '@/server/application-service'
import { jsonError } from '@/server/http'

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  const result = getApplication(id)
  return result.ok ? NextResponse.json(result.value) : jsonError(result.failure)
}
