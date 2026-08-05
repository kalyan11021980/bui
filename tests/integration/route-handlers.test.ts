import { describe, it, expect, beforeEach } from 'vitest'

// A fixed, 32+ char test secret so the route's audit log never depends on
// (or silently falls back to) the development default. Must be set before
// the first getAuditLog() call — the singleton is constructed lazily, so
// setting it here at module load, ahead of every test, is sufficient.
process.env.AUDIT_DIGEST_SECRET = 'route-handler-test-secret-32-chars-min!'

import { POST as CREATE } from '@/app/api/application/route'
import { GET } from '@/app/api/application/[id]/route'
import { POST } from '@/app/api/application/[id]/actions/route'
import { OWNER_TOKEN_HEADER } from '@/server/ownership'
import { __resetStoreForTests } from '@/server/store'
import { getAuditLog, __resetAuditLogForTests } from '@/server/audit'
import type { ApplicationState } from '@/domain/application/state'

const AT = '2026-08-01T12:00:00.000Z'

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init)
}

/** Every application this file created, against the token it was handed. */
const tokens = new Map<string, string>()

/** What the owner of `id` presents. Nothing, for an id nobody was given. */
function asOwner(id: string): Record<string, string> {
  const token = tokens.get(id)
  return token === undefined ? {} : { [OWNER_TOKEN_HEADER]: token }
}

function postBody(id: string, action: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify({ action }),
    headers: { 'content-type': 'application/json', ...asOwner(id) },
  }
}

/** Next hands a dynamic segment handler its params as a Promise. */
function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

/**
 * Creates an application the only way a caller can: by asking for one and
 * being told its server-generated id. Tests cannot name an application into
 * existence any more, which is the point of the change.
 */
async function newApp(): Promise<string> {
  const res = await CREATE()
  const body = (await res.json()) as ApplicationState
  if (body.ownerToken === null) throw new Error('creation handed out no owner token')
  tokens.set(body.id, body.ownerToken)
  return body.id
}

async function post(id: string, action: unknown) {
  return POST(
    req(`http://localhost/api/application/${id}/actions`, postBody(id, action)),
    ctx(id),
  )
}

async function read(id: string, headers: Record<string, string> = asOwner(id)) {
  return GET(req(`http://localhost/api/application/${id}`, { headers }), ctx(id))
}

async function stateOf(id: string): Promise<ApplicationState> {
  return (await (await read(id)).json()) as ApplicationState
}

/** A business applicant, which is what the licence and tax fields need. */
async function newBusiness(): Promise<string> {
  const id = await newApp()
  await post(id, {
    type: 'UPDATE_PROFILE', patch: { applicantType: 'business', state: 'GA' }, at: AT,
  })
  return id
}

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
  tokens.clear()
})

describe('POST /api/application — creation', () => {
  it('creates a new application, stamped with a rules version', async () => {
    const res = await CREATE()
    expect(res.status).toBe(200)
    const body = (await res.json()) as ApplicationState
    expect(body.id).toBeTruthy()
    expect(body.rulesVersion).toBeGreaterThan(0)
  })

  it('generates the id itself rather than trusting one the caller names', async () => {
    // An id the caller supplied used to be created on demand, so /1 and /2
    // both worked — and the response carries tax_id.value.
    const res = await read('1')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/unknown/i) })
  })

  it('does not hand out sequential, guessable ids', async () => {
    const ids = [await newApp(), await newApp(), await newApp()]
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
  })

  it('returns the same application on a second read instead of recreating it', async () => {
    const id = await newApp()
    const first = await stateOf(id)
    const second = await stateOf(id)
    expect(second).toEqual(first)
  })
})

describe('POST /api/application/[id]/actions', () => {
  it('404s for an unknown application id', async () => {
    const res = await post('nope', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT,
    })
    expect(res.status).toBe(404)
  })

  it('applies a valid SET_VALUE and returns the updated state', async () => {
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as ApplicationState
    expect(body.fields.first_name?.value).toBe('Ada')
    expect(body.fields.first_name?.status).toBe('confirmed')
  })

  it('records a SET_VALUE for tax_id in the audit log, but never the raw value', async () => {
    // A taxpayer ID is only ever asked of a business, and the route now
    // refuses fields outside the requirements engine's set — so this reaches
    // tax_id the way a real applicant does, by being a business.
    const id = await newBusiness()

    const before = getAuditLog().sizeFor(id)
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'tax_id', value: '12-3456789', source: 'user', at: AT,
    })
    expect(res.status).toBe(200)

    const log = getAuditLog()
    expect(log.sizeFor(id)).toBe(before + 1)
    expect(JSON.stringify(log.entries())).not.toContain('12-3456789')
  })

  it('files each application\'s events under its own id, not one shared stream', async () => {
    const a = await newApp()
    const b = await newApp()

    await post(a, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT,
    })
    await post(b, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Bob', source: 'user',
      at: '2026-08-01T12:00:01.000Z',
    })

    const log = getAuditLog()
    expect(log.entriesFor(a).map((e) => e.value)).toEqual(['Ada'])
    expect(log.entriesFor(b).map((e) => e.value)).toEqual(['Bob'])
    expect(log.entriesFor(a)[0]?.seq).toBe(1)
    expect(log.entriesFor(b)[0]?.seq).toBe(1)
  })
})

describe('POST /api/application/[id]/actions — carried provenance', () => {
  it('carries a personal address into the business address on the write path', async () => {
    // applyCarry had no caller outside tests: the route applied the reducer
    // and persisted, so the headline case was unsolved in the running app.
    const id = await newBusiness()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'addr_line1', value: '2345 Anywhere St',
      source: 'user', at: AT,
    })

    const body = (await res.json()) as ApplicationState
    expect(body.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')
    // Carried, so still `derived`: the applicant confirms it. Carrying saves
    // typing, not attention.
    expect(body.fields.biz_addr_line1?.status).toBe('derived')
    expect(body.fields.biz_addr_line1?.provenance?.fromFieldId).toBe('addr_line1')
  })

  it('audits every carried value, not just the action that triggered it', async () => {
    const id = await newBusiness()
    const before = getAuditLog().sizeFor(id)

    await post(id, {
      type: 'SET_VALUE', fieldId: 'addr_city', value: 'Atlanta', source: 'user', at: AT,
    })

    const trail = getAuditLog().entriesFor(id)
    expect(trail.length).toBe(before + 2)
    const carried = trail.find((e) => e.fieldId === 'biz_addr_city')
    expect(carried).toBeDefined()
    expect(carried?.source).toBe('carried')
    expect(carried?.value).toBe('Atlanta')
  })

  it('persists the carried value, not just the reduced one', async () => {
    const id = await newBusiness()
    await post(id, {
      type: 'SET_VALUE', fieldId: 'addr_zip', value: '30301', source: 'user', at: AT,
    })

    expect((await stateOf(id)).fields.biz_addr_zip?.value).toBe('30301')
  })

  it('does not carry into fields an individual applicant is never asked for', async () => {
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'addr_line1', value: '2345 Anywhere St',
      source: 'user', at: AT,
    })

    const body = (await res.json()) as ApplicationState
    expect(body.fields.biz_addr_line1).toBeUndefined()
  })
})

/**
 * The spec names this handler as the enforcement point. Every case below
 * returned 200 and was stored before this wave. Phase 3 puts an LLM on this
 * exact surface, so each of these is a tool call a misbehaving model can make.
 */
describe('POST /api/application/[id]/actions — enforcement', () => {
  it('400s on a body that is not JSON at all', async () => {
    const id = await newApp()
    const res = await POST(
      req(`http://localhost/api/application/${id}/actions`, {
        method: 'POST', body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
      ctx(id),
    )
    expect(res.status).toBe(400)
  })

  it('400s on a body missing the action entirely', async () => {
    const id = await newApp()
    expect((await post(id, undefined)).status).toBe(400)
  })

  it('400s on an unrecognised action type', async () => {
    const id = await newApp()
    const res = await post(id, { type: 'DROP_TABLE', at: AT })
    expect(res.status).toBe(400)
  })

  it('400s on an action carrying an unrecognised property', async () => {
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user',
      at: AT, patch: { wantsGsa: true },
    })
    expect(res.status).toBe(400)
  })

  it('422s and stores nothing for a value the field schema refuses', async () => {
    // The table row: `SET_VALUE dob = {evil:1}` was stored, status confirmed.
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'dob', value: { evil: 1 }, source: 'user', at: AT,
    })
    expect(res.status).toBe(422)
    expect((await stateOf(id)).fields.dob).toBeUndefined()
  })

  it('422s and stores nothing for a field id that is not in the catalog', async () => {
    // The table row: `SET_VALUE not_a_field = 'zzz'` was stored under a
    // non-existent key. This is also the network path to the C2 leak.
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'not_a_field', value: 'zzz', source: 'user', at: AT,
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/unknown field/i) })
    const fields = (await stateOf(id)).fields as Record<string, unknown>
    expect(fields.not_a_field).toBeUndefined()
  })

  it('never lets an unknown field id put a raw sensitive value in the log', async () => {
    // The C2 probe, driven from the network exactly as reported.
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'tax_id_typo', value: '123-45-6789',
      source: 'user', at: AT,
    })
    expect(res.status).toBe(422)
    expect(JSON.stringify(getAuditLog().entries())).not.toContain('123-45-6789')
  })

  it('422s for a field outside the applicant\'s required set', async () => {
    // The table row: `SET_VALUE gsa_bidder_number` with `wantsGsa: false`.
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'gsa_bidder_number', value: 'GSA-1',
      source: 'user', at: AT,
    })
    expect(res.status).toBe(422)
    expect(await res.json())
      .toMatchObject({ error: expect.stringMatching(/not part of this application/i) })
  })

  it('accepts the same field once the profile actually requires it', async () => {
    // The mirror of the case above: enforcement must track the profile, not
    // just say no to everything unusual.
    const id = await newApp()
    await post(id, { type: 'UPDATE_PROFILE', patch: { wantsGsa: true }, at: AT })
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'gsa_bidder_number', value: 'GSA-1',
      source: 'user', at: '2026-08-01T12:00:01.000Z',
    })
    expect(res.status).toBe(200)
  })

  it('422s rather than 500ing when the reducer refuses the action', async () => {
    // CONFIRM on a field with no value throws inside the reducer; it escaped
    // POST uncaught and became a 500 with a dev stack trace.
    const id = await newApp()
    const res = await post(id, {
      type: 'CONFIRM', fieldId: 'first_name', at: AT, shownCopyHash: 'catalog-v1',
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/no value yet/i) })
  })

  it('400s on a profile patch carrying an unrecognised key', async () => {
    const id = await newApp()
    const res = await post(id, {
      type: 'UPDATE_PROFILE', patch: { applicantTyp: 'business' }, at: AT,
    })
    expect(res.status).toBe(400)
  })

  it('400s on a profile patch with a licence type that does not exist', async () => {
    const id = await newApp()
    const res = await post(id, {
      type: 'UPDATE_PROFILE', patch: { licenses: ['forklift'] }, at: AT,
    })
    expect(res.status).toBe(400)
  })

  it('runs the field\'s own catalog schema — a bad ZIP is refused', async () => {
    const id = await newApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'addr_zip', value: 'not-a-zip', source: 'user', at: AT,
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/ZIP/i) })
  })

  it('422s a submission while requirements remain, naming what is missing', async () => {
    const id = await newApp()
    const res = await post(id, { type: 'SUBMIT', at: AT })
    expect(res.status).toBe(422)
    expect(await res.json())
      .toMatchObject({ error: expect.stringMatching(/cannot submit.*outstanding/is) })
    expect((await stateOf(id)).submittedAt).toBeNull()
  })

  it('accepts a submission once nothing is outstanding, and audits it', async () => {
    const id = await newApp()
    const answers: Array<[string, unknown]> = [
      ['primary_activity', 'dealer'], ['preferred_language', 'English'],
      ['first_name', 'Ada'], ['last_name', 'Lovelace'],
      ['dl_number', 'D1234567'],
      ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'],
      ['id_images', ['front.png']],
      ['id_country', 'USA'], ['id_state', 'GA'],
      ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
      ['addr_state', 'GA'], ['addr_zip', '30301'],
      ['phone_mobile', '4045551234'],
    ]
    for (const [fieldId, value] of answers) {
      const res = await post(id, {
        type: 'SET_VALUE', fieldId, value, source: 'user', at: AT,
      })
      expect(res.status, `${fieldId} should have been accepted`).toBe(200)
    }

    const res = await post(id, { type: 'SUBMIT', at: '2026-08-01T13:00:00.000Z' })
    expect(res.status).toBe(200)
    expect((await stateOf(id)).submittedAt).toBe('2026-08-01T13:00:00.000Z')

    const trail = getAuditLog().entriesFor(id)
    expect(trail.at(-1)?.kind).toBe('submitted')
  })

  it('refuses an impossible calendar date, not just a badly-shaped one', async () => {
    const id = await newApp()
    for (const bad of ['1982-13-45', '2026-02-30', '31-08-1982']) {
      const res = await post(id, {
        type: 'SET_VALUE', fieldId: 'dob', value: bad, source: 'user', at: AT,
      })
      expect(res.status, `${bad} must be refused`).toBe(422)
    }
    const ok = await post(id, {
      type: 'SET_VALUE', fieldId: 'dob', value: '1982-08-31', source: 'user', at: AT,
    })
    expect(ok.status).toBe(200)
  })
})

describe('POST /api/application/[id]/actions — a submitted application is closed', () => {
  const LATER = '2026-08-02T09:00:00.000Z'

  /** A complete, submitted application, created the way a caller would. */
  async function submittedApp(): Promise<string> {
    const id = await newApp()
    const answers: Array<[string, unknown]> = [
      ['primary_activity', 'dealer'], ['preferred_language', 'English'],
      ['first_name', 'Ada'], ['last_name', 'Lovelace'],
      ['dl_number', 'D1234567'],
      ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'],
      ['id_images', ['front.png']],
      ['id_country', 'USA'], ['id_state', 'GA'],
      ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
      ['addr_state', 'GA'], ['addr_zip', '30301'],
      ['phone_mobile', '4045551234'],
    ]
    for (const [fieldId, value] of answers) {
      const res = await post(id, {
        type: 'SET_VALUE', fieldId, value, source: 'user', at: AT,
      })
      expect(res.status, `${fieldId} should have been accepted`).toBe(200)
    }
    expect((await post(id, { type: 'SUBMIT', at: AT })).status).toBe(200)
    return id
  }

  it('409s the exact probe from the re-review, and stores nothing', async () => {
    // "complete a 12-field registration → SUBMIT → 200 → then SET_VALUE
    // first_name = 'Mallory' → 200, and the stored value becomes 'Mallory'."
    // An application sent for review could be rewritten afterwards while the
    // reviewer's copy diverged.
    const id = await submittedApp()

    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Mallory',
      source: 'user', at: LATER,
    })

    expect(res.status).toBe(409)
    expect(await res.json())
      .toMatchObject({ error: expect.stringMatching(/sent for review/i) })
    expect((await stateOf(id)).fields.first_name?.value).toBe('Ada')
  })

  it('409s every other mutating action too, and leaves the record alone', async () => {
    const id = await submittedApp()
    const before = JSON.stringify(await stateOf(id))

    const actions: unknown[] = [
      { type: 'CONFIRM', fieldId: 'first_name', at: LATER, shownCopyHash: 'catalog-v1' },
      { type: 'VERIFY', fieldId: 'first_name', at: LATER },
      { type: 'REJECT', fieldId: 'first_name', at: LATER, reason: 'looks wrong' },
      { type: 'SUPERSEDE', fieldId: 'first_name', at: LATER },
      { type: 'UPDATE_PROFILE', patch: { applicantType: 'business' }, at: LATER },
      { type: 'SUBMIT', at: LATER },
    ]
    for (const action of actions) {
      const res = await post(id, action)
      expect(res.status, JSON.stringify(action)).toBe(409)
    }

    expect(JSON.stringify(await stateOf(id))).toBe(before)
  })

  it('writes nothing to the audit trail for a refused action', async () => {
    // A refusal that still appended would put an event in the compliance
    // record for a change that never happened.
    const id = await submittedApp()
    const before = getAuditLog().sizeFor(id)

    await post(id, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Mallory',
      source: 'user', at: LATER,
    })

    expect(getAuditLog().sizeFor(id)).toBe(before)
  })

  it('separates "already decided" from "not allowed" — 409, not 422', async () => {
    // 422 says "well-formed and not allowed"; a caller retrying with a better
    // value would be reasonable. 409 says the state moved on and no value
    // will be accepted, which is the truth here.
    const id = await submittedApp()
    const res = await post(id, {
      type: 'SET_VALUE', fieldId: 'addr_zip', value: 'not-a-zip',
      source: 'user', at: LATER,
    })
    expect(res.status).toBe(409)
  })

  it('still reads back, because the record is closed and not gone', async () => {
    const id = await submittedApp()
    const res = await read(id)
    expect(res.status).toBe(200)
    expect(((await res.json()) as ApplicationState).submittedAt).toBe(AT)
  })
})

describe('POST /api/application/[id]/actions — CLEAR_VALUE', () => {
  it('returns a field to outstanding and records it in the trail', async () => {
    const id = await newApp()
    await post(id, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT,
    })

    const res = await post(id, { type: 'CLEAR_VALUE', fieldId: 'first_name', at: AT })

    expect(res.status).toBe(200)
    expect((await stateOf(id)).fields.first_name?.value).toBeNull()
    expect(getAuditLog().entriesFor(id).at(-1)).toMatchObject({
      kind: 'value_cleared', fieldId: 'first_name',
    })
  })

  it('never writes the cleared value into the trail, sensitive or not', async () => {
    // There is no value to record — the field now holds nothing — and a
    // "cleared" event carrying the old plaintext would be a second PII path
    // out of the domain for no gain. The SET_VALUE that put it there is
    // already in the trail, digested if the field is sensitive.
    const id = await newApp()
    await post(id, {
      type: 'SET_VALUE', fieldId: 'dob', value: '1982-08-31', source: 'user', at: AT,
    })
    await post(id, { type: 'CLEAR_VALUE', fieldId: 'dob', at: AT })

    const event = getAuditLog().entriesFor(id).at(-1)
    expect(event?.kind).toBe('value_cleared')
    expect(event).not.toHaveProperty('value')
    expect(JSON.stringify(event)).not.toContain('1982-08-31')
  })

  it('refuses to clear a field that is not part of this application', async () => {
    const id = await newApp()
    const res = await post(id, { type: 'CLEAR_VALUE', fieldId: 'tax_id', at: AT })
    expect(res.status).toBe(422)
  })

  it('clears the carried mirror alongside it, and audits that too', async () => {
    const id = await newBusiness()
    await post(id, {
      type: 'SET_VALUE', fieldId: 'addr_line1', value: '2345 Anywhere St',
      source: 'user', at: AT,
    })
    expect((await stateOf(id)).fields.biz_addr_line1?.value).toBe('2345 Anywhere St')

    await post(id, { type: 'CLEAR_VALUE', fieldId: 'addr_line1', at: AT })

    expect((await stateOf(id)).fields.biz_addr_line1?.value).toBeNull()
    const kinds = getAuditLog().entriesFor(id).slice(-2).map((e) => e.kind)
    expect(kinds).toEqual(['value_cleared', 'value_cleared'])
  })

  it('400s a CLEAR_VALUE carrying anything it should not', async () => {
    const id = await newApp()
    const res = await post(id, {
      type: 'CLEAR_VALUE', fieldId: 'first_name', at: AT, value: 'Mallory',
    })
    expect(res.status).toBe(400)
  })
})
