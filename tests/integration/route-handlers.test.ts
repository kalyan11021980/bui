import { describe, it, expect, beforeEach } from 'vitest'

// A fixed, 32+ char test secret so the route's audit log never depends on
// (or silently falls back to) the development default. Must be set before
// the first getAuditLog() call — the singleton is constructed lazily, so
// setting it here at module load, ahead of every test, is sufficient.
process.env.AUDIT_DIGEST_SECRET = 'route-handler-test-secret-32-chars-min!'

import { GET, POST } from '@/app/api/application/route'
import { resetStore } from '@/server/store'
import { getAuditLog, __resetAuditLogForTests } from '@/server/audit'
import type { ApplicationState } from '@/domain/application/state'

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init)
}

function postBody(id: string, action: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify({ id, action }),
    headers: { 'content-type': 'application/json' },
  }
}

beforeEach(() => {
  resetStore()
  __resetAuditLogForTests()
})

describe('GET /api/application', () => {
  it('400s when no id is given', async () => {
    const res = await GET(req('http://localhost/api/application'))
    expect(res.status).toBe(400)
  })

  it('creates and returns a new application, stamped with a rules version', async () => {
    const res = await GET(req('http://localhost/api/application?id=app-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as ApplicationState
    expect(body.id).toBe('app-1')
    expect(body.rulesVersion).toBeGreaterThan(0)
  })

  it('returns the same application on a second GET instead of recreating it', async () => {
    const first = await GET(req('http://localhost/api/application?id=app-1'))
    const firstBody = (await first.json()) as ApplicationState

    const second = await GET(req('http://localhost/api/application?id=app-1'))
    const secondBody = (await second.json()) as ApplicationState

    expect(secondBody).toEqual(firstBody)
  })
})

describe('POST /api/application', () => {
  it('404s for an unknown application id', async () => {
    const res = await POST(
      req('http://localhost/api/application', postBody('nope', {
        type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada',
        source: 'user', at: '2026-08-01T12:00:00.000Z',
      })),
    )
    expect(res.status).toBe(404)
  })

  it('applies a valid SET_VALUE and returns the updated state', async () => {
    await GET(req('http://localhost/api/application?id=app-1'))

    const res = await POST(
      req('http://localhost/api/application', postBody('app-1', {
        type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada',
        source: 'user', at: '2026-08-01T12:00:00.000Z',
      })),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as ApplicationState
    expect(body.fields.first_name?.value).toBe('Ada')
    expect(body.fields.first_name?.status).toBe('confirmed')
  })

  it('records a SET_VALUE for tax_id in the audit log, but never the raw value', async () => {
    await GET(req('http://localhost/api/application?id=app-1'))

    const before = getAuditLog().size()
    const res = await POST(
      req('http://localhost/api/application', postBody('app-1', {
        type: 'SET_VALUE', fieldId: 'tax_id', value: '12-3456789',
        source: 'user', at: '2026-08-01T12:00:00.000Z',
      })),
    )
    expect(res.status).toBe(200)

    const log = getAuditLog()
    expect(log.size()).toBe(before + 1)
    expect(JSON.stringify(log.entries())).not.toContain('12-3456789')
  })

  it('files each application\'s events under its own id, not one shared stream', async () => {
    await GET(req('http://localhost/api/application?id=app-a'))
    await GET(req('http://localhost/api/application?id=app-b'))

    await POST(req('http://localhost/api/application', postBody('app-a', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada',
      source: 'user', at: '2026-08-01T12:00:00.000Z',
    })))
    await POST(req('http://localhost/api/application', postBody('app-b', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Bob',
      source: 'user', at: '2026-08-01T12:00:01.000Z',
    })))

    const log = getAuditLog()
    expect(log.entriesFor('app-a').map((e) => e.value)).toEqual(['Ada'])
    expect(log.entriesFor('app-b').map((e) => e.value)).toEqual(['Bob'])
    expect(log.entriesFor('app-a')[0]?.seq).toBe(1)
    expect(log.entriesFor('app-b')[0]?.seq).toBe(1)
  })
})
