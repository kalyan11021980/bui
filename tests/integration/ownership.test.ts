import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.AUDIT_DIGEST_SECRET = 'ownership-test-secret-32-chars-min!!'

/**
 * Counts the reads as well as answering them: an upload refused for the wrong
 * token must be refused before anything is spent on it, and "the call threw"
 * is not the same evidence as "the call was never made".
 */
const ocr = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/server/ocr/mistral', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/ocr/mistral')>()
  const { readFileSync: read } = await import('node:fs')
  const fixture = JSON.parse(read('sample/licenses/fixtures/wa_enhanced.json', 'utf8'))
  return {
    ...actual,
    requestMistralOcr: async () => {
      ocr.calls += 1
      // Mistral OCR returns markdown; detections are gone (no bounding boxes).
      return { text: fixture.text }
    },
  }
})

vi.mock('@/server/ocr/llm-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/ocr/llm-extract')>()
  const { NO_EVIDENCE } = await import('@/domain/ocr/extract')
  return {
    ...actual,
    envExtractor: () => async () => [
      { key: 'dl_number', raw: 'WDLJK00580GF', evidence: { ...NO_EVIDENCE } },
    ],
  }
})

import { POST as CREATE } from '@/app/api/application/route'
import { GET } from '@/app/api/application/[id]/route'
import { POST as ACTION } from '@/app/api/application/[id]/actions/route'
import { POST as UPLOAD } from '@/app/api/application/[id]/documents/route'
import { createApplication } from '@/server/application-service'
import { getAuditLog, __resetAuditLogForTests } from '@/server/audit'
import { OWNER_TOKEN_HEADER, ownsApplication } from '@/server/ownership'
import { __resetStoreForTests } from '@/server/store'
import { OWNER_TOKEN_HEADER as CLIENT_HEADER } from '@/ui/client/application-api'
import type { ApplicationState } from '@/domain/application/state'

/**
 * Knowing an application id used to be enough to read a taxpayer ID and a date
 * of birth out of it, and to post photographs of an identity document to it.
 * The token is a capability, not a login: these say it is required, that the
 * refusal gives nothing away, and that the token is never echoed back.
 */

const AT = '2026-08-02T00:00:00.000Z'
const WA_PNG = readFileSync('sample/licenses/specimens/wa_enhanced.png').toString('base64')

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

function headers(token: string | null): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(token !== null && { [OWNER_TOKEN_HEADER]: token }),
  }
}

type Created = { id: string; token: string }

async function newApp(): Promise<Created> {
  const body = (await (await CREATE()).json()) as ApplicationState
  // Asserted rather than thrown: a helper that throws pre-empts every
  // assertion under it, and "creation hands one out" is the property.
  expect(body.ownerToken, 'creation must hand out an owner token')
    .toEqual(expect.any(String))
  return { id: body.id, token: body.ownerToken ?? '' }
}

function read(id: string, token: string | null) {
  return GET(
    new Request(`http://localhost/api/application/${id}`, { headers: headers(token) }),
    ctx(id),
  )
}

function act(id: string, token: string | null, action: unknown) {
  return ACTION(
    new Request(`http://localhost/api/application/${id}/actions`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ action }),
    }),
    ctx(id),
  )
}

function upload(id: string, token: string | null) {
  return UPLOAD(
    new Request(`http://localhost/api/application/${id}/documents`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ docType: 'drivers_license', imageBase64: WA_PNG }),
    }),
    ctx(id),
  )
}

const setName = (value: string) =>
  ({ type: 'SET_VALUE', fieldId: 'first_name', value, source: 'user', at: AT })

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
  ocr.calls = 0
  vi.stubEnv('OCR_ENDPOINT', 'http://ocr.test')
  vi.stubEnv('OCR_MODEL', 'test-model')
  vi.stubEnv('OCR_API_KEY', 'test-key')
})

describe('an application id is not enough on its own', () => {
  it('hands out a token when the application is created', async () => {
    const { token } = await newApp()
    expect(token)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('refuses a token of the wrong length rather than throwing at the caller', () => {
    // The comparison is timing-safe, and its primitive throws when the two
    // buffers differ in length. A junk token has to meet a refusal, not a
    // RangeError out of the route — and a throw would pre-empt the 404 the
    // route cases assert, so it is stated here directly.
    const state = createApplication()

    for (const junk of ['', 'x', `${state.ownerToken}x`]) {
      expect(() => ownsApplication(state, junk), junk).not.toThrow()
      expect(ownsApplication(state, junk), junk).toBe(false)
    }
    // Guards the guard: a comparison that refused everything would pass above.
    expect(ownsApplication(state, state.ownerToken)).toBe(true)
  })

  it('gives every application its own token', async () => {
    const [a, b] = [await newApp(), await newApp()]
    expect(a.token).not.toBe(b.token)
  })

  it('lets the owner read, write and upload', async () => {
    // Guards the refusals below: a route that answered 404 to everything would
    // pass all of them.
    const { id, token } = await newApp()

    expect((await read(id, token)).status).toBe(200)
    expect((await act(id, token, setName('Ada'))).status).toBe(200)
    expect((await upload(id, token)).status).toBe(200)
  })

  describe.each([
    ['reading it', read],
    ['writing to it', (id: string, token: string | null) => act(id, token, setName('Mallory'))],
    ['uploading a document to it', upload],
  ])('%s', (_name, call) => {
    it('404s a caller who presents no token at all', async () => {
      const { id } = await newApp()
      expect((await call(id, null)).status).toBe(404)
    })

    it('404s a caller who presents the wrong token', async () => {
      const { id } = await newApp()
      expect((await call(id, 'e1b3e0f6-0000-4000-8000-000000000000')).status).toBe(404)
    })

    it('404s a caller holding a different application\'s token', async () => {
      const mine = await newApp()
      const theirs = await newApp()
      expect((await call(mine.id, theirs.token)).status).toBe(404)
    })

    it('404s a token that is the right shape but empty', async () => {
      const { id } = await newApp()
      expect((await call(id, '')).status).toBe(404)
    })
  })

  it('answers a wrong token exactly as it answers an id that does not exist', async () => {
    // 403 would confirm the id exists, which is the same leak wearing a
    // smaller hat. Status and words both have to match.
    const { id } = await newApp()

    const refused = await read(id, 'e1b3e0f6-0000-4000-8000-000000000000')
    const unknown = await read('no-such-application', 'e1b3e0f6-0000-4000-8000-000000000000')

    expect(refused.status).toBe(404)
    expect(refused.status).toBe(unknown.status)
    expect(await refused.json()).toEqual(await unknown.json())
  })

  it('writes nothing when it refuses an action', async () => {
    const { id, token } = await newApp()
    expect((await act(id, token, setName('Ada'))).status).toBe(200)
    const before = getAuditLog().sizeFor(id)

    expect((await act(id, null, setName('Mallory'))).status).toBe(404)

    const state = (await (await read(id, token)).json()) as ApplicationState
    expect(state.fields.first_name?.value).toBe('Ada')
    expect(getAuditLog().sizeFor(id)).toBe(before)
  })

  it('spends no OCR call on an upload it refuses', async () => {
    // The photograph is of an identity document. Refusing it after paying for
    // the OCR read would still have read it.
    const { id } = await newApp()

    expect((await upload(id, null)).status).toBe(404)

    expect(ocr.calls).toBe(0)
  })
})

describe('the token is returned exactly once', () => {
  it('is absent from every response but the creation one', async () => {
    const { id, token } = await newApp()

    const acted = await (await act(id, token, setName('Ada'))).text()
    const uploaded = await (await upload(id, token)).text()
    const got = await (await read(id, token)).text()

    // Each one has to have succeeded, or a refusal would satisfy every
    // assertion below by carrying nothing at all.
    expect((JSON.parse(acted) as ApplicationState).id).toBe(id)
    expect((JSON.parse(uploaded) as { filled: string[] }).filled.length).toBeGreaterThan(0)
    expect((JSON.parse(got) as ApplicationState).id).toBe(id)

    for (const body of [acted, uploaded, got]) expect(body).not.toContain(token)

    // Not merely missing from the text: the field is present, and null.
    expect((JSON.parse(acted) as ApplicationState).ownerToken).toBeNull()
    expect((JSON.parse(got) as ApplicationState).ownerToken).toBeNull()
    expect((JSON.parse(uploaded) as { state: ApplicationState }).state.ownerToken).toBeNull()
  })

  it('never reaches the audit trail, which outlives the request', async () => {
    const { id, token } = await newApp()
    await act(id, token, setName('Ada'))

    expect(getAuditLog().sizeFor(id)).toBeGreaterThan(0)
    expect(JSON.stringify(getAuditLog().entries())).not.toContain(token)
  })
})

describe('the header', () => {
  it('is named the same on both sides of the wire', async () => {
    // The browser cannot import the server module — it reads node:crypto — so
    // the name is written twice. This is what keeps the two copies equal.
    expect(CLIENT_HEADER).toBe(OWNER_TOKEN_HEADER)
  })
})
