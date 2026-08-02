import { NextResponse } from 'next/server'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { getApplication, putApplication } from '@/server/store'
import { getAuditLog } from '@/server/audit'
import type { Action } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = getApplication(id)
  if (existing) return NextResponse.json(existing)

  const profile: ApplicantProfile = {
    applicantType: 'individual',
    country: 'US',
    state: null,
    wantsGsa: false,
    licenses: [],
  }
  const created = createApplication(id, profile)
  putApplication(created)
  return NextResponse.json(created)
}

export async function POST(request: Request) {
  const body = (await request.json()) as { id: string; action: Action }
  const current = getApplication(body.id)
  if (!current) {
    return NextResponse.json({ error: 'unknown application' }, { status: 404 })
  }

  const next = applicationReducer(current, body.action)
  // Record the action before persisting the state it produces: an action we
  // cannot audit is an action we should not apply. If the audit call throws,
  // the store must be left untouched rather than silently holding a mutation
  // with no corresponding trail entry.
  getAuditLog().append(body.action)
  putApplication(next)
  return NextResponse.json(next)
}
