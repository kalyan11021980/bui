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
    // A taxpayer ID is only ever asked of a business, and the route now
    // refuses fields outside the requirements engine's set — so this test has
    // to reach tax_id the way a real applicant does, by being a business.
    await POST(req('http://localhost/api/application', postBody('app-1', {
      type: 'UPDATE_PROFILE', patch: { applicantType: 'business' },
      at: '2026-08-01T11:59:00.000Z',
    })))

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

describe('POST /api/application — carried provenance (§9)', () => {
  const AT = '2026-08-01T12:00:00.000Z'

  async function business(id: string) {
    await GET(req(`http://localhost/api/application?id=${id}`))
    await POST(req('http://localhost/api/application', postBody(id, {
      type: 'UPDATE_PROFILE', patch: { applicantType: 'business', state: 'GA' }, at: AT,
    })))
  }

  it('carries a personal address into the business address on the write path', async () => {
    // applyCarry had no caller outside tests: the route applied the reducer
    // and persisted, so §9's headline case was unsolved in the running app.
    await business('app-1')
    const res = await POST(req('http://localhost/api/application', postBody('app-1', {
      type: 'SET_VALUE', fieldId: 'addr_line1', value: '2345 Anywhere St',
      source: 'user', at: AT,
    })))

    const body = (await res.json()) as ApplicationState
    expect(body.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
    // Carried, so still `derived`: the applicant confirms it. Carrying saves
    // typing, not attention.
    expect(body.fields.biz_addr_line1?.status).toBe('derived')
    expect(body.fields.biz_addr_line1?.provenance?.fromFieldId).toBe('addr_line1')
  })

  it('audits every carried value, not just the action that triggered it', async () => {
    await business('app-1')
    const before = getAuditLog().sizeFor('app-1')

    await POST(req('http://localhost/api/application', postBody('app-1', {
      type: 'SET_VALUE', fieldId: 'addr_city', value: 'Atlanta',
      source: 'user', at: AT,
    })))

    const trail = getAuditLog().entriesFor('app-1')
    expect(trail.length).toBe(before + 2)
    const carried = trail.find((e) => e.fieldId === 'biz_addr_city')
    expect(carried).toBeDefined()
    expect(carried?.source).toBe('carried')
    expect(carried?.value).toBe('Atlanta')
  })

  it('persists the carried value, not just the reduced one', async () => {
    await business('app-1')
    await POST(req('http://localhost/api/application', postBody('app-1', {
      type: 'SET_VALUE', fieldId: 'addr_zip', value: '30301',
      source: 'user', at: AT,
    })))

    const res = await GET(req('http://localhost/api/application?id=app-1'))
    const reloaded = (await res.json()) as ApplicationState
    expect(reloaded.fields.biz_addr_zip?.value).toBe('30301')
  })

  it('does not carry into fields an individual applicant is never asked for', async () => {
    await GET(req('http://localhost/api/application?id=app-2'))
    const res = await POST(req('http://localhost/api/application', postBody('app-2', {
      type: 'SET_VALUE', fieldId: 'addr_line1', value: '2345 Anywhere St',
      source: 'user', at: AT,
    })))

    const body = (await res.json()) as ApplicationState
    expect(body.fields.biz_addr_line1).toBeUndefined()
  })
})

/**
 * Spec §8.2 names this handler as the enforcement point. Every case below
 * returned 200 and was stored before this wave. Phase 3 puts an LLM on this
 * exact surface, so each of these is a tool call a misbehaving model can make.
 */
describe('POST /api/application — §8.2 enforcement', () => {
  async function post(id: string, action: unknown) {
    return POST(req('http://localhost/api/application', postBody(id, action)))
  }
  async function newApp(id: string) {
    await GET(req(`http://localhost/api/application?id=${id}`))
  }
  async function stateOf(id: string): Promise<ApplicationState> {
    const res = await GET(req(`http://localhost/api/application?id=${id}`))
    return (await res.json()) as ApplicationState
  }

  it('400s on a body that is not JSON at all', async () => {
    const res = await POST(
      req('http://localhost/api/application', {
        method: 'POST', body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('400s on a body missing the action entirely', async () => {
    await newApp('app-1')
    const res = await post('app-1', undefined)
    expect(res.status).toBe(400)
  })

  it('400s on an unrecognised action type', async () => {
    await newApp('app-1')
    const res = await post('app-1', { type: 'DROP_TABLE', at: '2026-08-01T12:00:00.000Z' })
    expect(res.status).toBe(400)
  })

  it('400s on an action carrying an unrecognised property', async () => {
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user',
      at: '2026-08-01T12:00:00.000Z', patch: { wantsGsa: true },
    })
    expect(res.status).toBe(400)
  })

  it('422s and stores nothing for a value the field schema refuses', async () => {
    // The table row: `SET_VALUE dob = {evil:1}` was stored, status confirmed.
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'dob', value: { evil: 1 },
      source: 'user', at: '2026-08-01T12:00:00.000Z',
    })
    expect(res.status).toBe(422)
    expect((await stateOf('app-1')).fields.dob).toBeUndefined()
  })

  it('422s and stores nothing for a field id that is not in the catalog', async () => {
    // The table row: `SET_VALUE not_a_field = 'zzz'` was stored under a
    // non-existent key. This is also the network path to the C2 leak.
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'not_a_field', value: 'zzz',
      source: 'user', at: '2026-08-01T12:00:00.000Z',
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/unknown field/i) })
    const fields = (await stateOf('app-1')).fields as Record<string, unknown>
    expect(fields.not_a_field).toBeUndefined()
  })

  it('never lets an unknown field id put a raw sensitive value in the log', async () => {
    // The C2 probe, driven from the network exactly as reported.
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'tax_id_typo', value: '123-45-6789',
      source: 'user', at: '2026-08-01T12:00:00.000Z',
    })
    expect(res.status).toBe(422)
    expect(JSON.stringify(getAuditLog().entries())).not.toContain('123-45-6789')
  })

  it('422s for a field outside the applicant\'s required set', async () => {
    // The table row: `SET_VALUE gsa_bidder_number` with `wantsGsa: false`.
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'gsa_bidder_number', value: 'GSA-1',
      source: 'user', at: '2026-08-01T12:00:00.000Z',
    })
    expect(res.status).toBe(422)
    expect(await res.json())
      .toMatchObject({ error: expect.stringMatching(/not part of this application/i) })
  })

  it('accepts the same field once the profile actually requires it', async () => {
    // The mirror of the case above: enforcement must track the profile, not
    // just say no to everything unusual.
    await newApp('app-1')
    await post('app-1', {
      type: 'UPDATE_PROFILE', patch: { wantsGsa: true },
      at: '2026-08-01T12:00:00.000Z',
    })
    const res = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'gsa_bidder_number', value: 'GSA-1',
      source: 'user', at: '2026-08-01T12:00:01.000Z',
    })
    expect(res.status).toBe(200)
  })

  it('422s rather than 500ing when the reducer refuses the action', async () => {
    // CONFIRM on a field with no value throws inside the reducer; it escaped
    // POST uncaught and became a 500 with a dev stack trace.
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'CONFIRM', fieldId: 'first_name',
      at: '2026-08-01T12:00:00.000Z', shownCopyHash: 'catalog-v1',
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/no value yet/i) })
  })

  it('400s on a profile patch carrying an unrecognised key', async () => {
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'UPDATE_PROFILE', patch: { applicantTyp: 'business' },
      at: '2026-08-01T12:00:00.000Z',
    })
    expect(res.status).toBe(400)
  })

  it('400s on a profile patch with a licence type that does not exist', async () => {
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'UPDATE_PROFILE', patch: { licenses: ['forklift'] },
      at: '2026-08-01T12:00:00.000Z',
    })
    expect(res.status).toBe(400)
  })

  it('runs the field\'s own catalog schema — a bad ZIP is refused', async () => {
    await newApp('app-1')
    const res = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'addr_zip', value: 'not-a-zip',
      source: 'user', at: '2026-08-01T12:00:00.000Z',
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/ZIP/i) })
  })

  it('refuses an impossible calendar date, not just a badly-shaped one', async () => {
    await newApp('app-1')
    for (const bad of ['1982-13-45', '2026-02-30', '31-08-1982']) {
      const res = await post('app-1', {
        type: 'SET_VALUE', fieldId: 'dob', value: bad,
        source: 'user', at: '2026-08-01T12:00:00.000Z',
      })
      expect(res.status, `${bad} must be refused`).toBe(422)
    }
    const ok = await post('app-1', {
      type: 'SET_VALUE', fieldId: 'dob', value: '1982-08-31',
      source: 'user', at: '2026-08-01T12:00:00.000Z',
    })
    expect(ok.status).toBe(200)
  })
})
