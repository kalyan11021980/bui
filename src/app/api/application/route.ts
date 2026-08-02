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
  putApplication(next)
  // The audit trail lives on the server, alongside the store it describes —
  // never in client code, which cannot be trusted to hold the digest secret.
  getAuditLog().append(body.action)
  return NextResponse.json(next)
}
