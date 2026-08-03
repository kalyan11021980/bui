import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.AUDIT_DIGEST_SECRET = 'document-route-test-secret-32-chars!!'

/**
 * The transport is stubbed, not the service: the route resolves its own
 * provider from the environment, so the only way to drive its success path
 * without a model on the other end is to replace the HTTP call underneath.
 */
vi.mock('@/server/ocr/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/ocr/client')>()
  const { readFileSync: read } = await import('node:fs')
  const fixture = JSON.parse(read('sample/licenses/fixtures/wa_enhanced.json', 'utf8'))
  return {
    ...actual,
    requestOcr: async ({ prompt }: { prompt: string }) =>
      prompt.includes('grounding')
        ? { text: fixture.text, detections: fixture.detections, completionTokens: null }
        : { text: fixture.plainText, detections: [], completionTokens: null },
  }
})

import { POST as CREATE } from '@/app/api/application/route'
import { POST as ACTION } from '@/app/api/application/[id]/actions/route'
import { POST } from '@/app/api/application/[id]/documents/route'
import { __resetAuditLogForTests } from '@/server/audit'
import { MAX_IMAGE_BASE64_CHARS } from '@/server/image-size'
import { __resetStoreForTests } from '@/server/store'
import type { ApplicationState } from '@/domain/application/state'
import { pngBase64 } from '../server/image-bytes'

const WA_PNG = readFileSync('sample/licenses/specimens/wa_enhanced.png').toString('base64')
const AT = '2026-08-02T00:00:00.000Z'

/**
 * The route is where an unset OCR_ENDPOINT has to be felt: it passes no
 * provider, so the service resolves one from the environment.
 */

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

/** Every application this file created, against the token it was handed. */
const tokens = new Map<string, string>()

/** What the owner of `id` presents. Nothing, for an id nobody was given. */
function asOwner(id: string): Record<string, string> {
  const token = tokens.get(id)
  return token === undefined ? {} : { 'x-owner-token': token }
}

async function upload(id: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/application/${id}/documents`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...asOwner(id) },
    }),
    ctx(id),
  )
}

async function newApp(): Promise<string> {
  const body = (await (await CREATE()).json()) as ApplicationState
  if (body.ownerToken === null) throw new Error('creation handed out no owner token')
  tokens.set(body.id, body.ownerToken)
  return body.id
}

async function action(id: string, body: unknown) {
  return ACTION(
    new Request(`http://localhost/api/application/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action: body }),
      headers: { 'content-type': 'application/json', ...asOwner(id) },
    }),
    ctx(id),
  )
}

/** An application with nothing outstanding, sent for review. */
async function submittedApp(): Promise<string> {
  const id = await newApp()
  const answers: [string, unknown][] = [
    ['primary_activity', 'dealer'], ['preferred_language', 'English'],
    ['first_name', 'Ada'], ['last_name', 'Lovelace'], ['dl_number', 'D1234567'],
    ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'], ['id_images', ['front.png']],
    ['id_country', 'US'], ['id_state', 'GA'],
    ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
    ['addr_state', 'GA'], ['addr_zip', '30301'], ['phone_mobile', '4045551234'],
  ]
  for (const [fieldId, value] of answers) {
    const res = await action(id, { type: 'SET_VALUE', fieldId, value, source: 'user', at: AT })
    expect(res.status, fieldId).toBe(200)
  }
  expect((await action(id, { type: 'SUBMIT', at: AT })).status).toBe(200)
  return id
}

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
  tokens.clear()
  vi.unstubAllEnvs()
})

describe('POST /api/application/[id]/documents — a successful upload', () => {
  beforeEach(() => {
    vi.stubEnv('OCR_ENDPOINT', 'http://ocr.test')
    vi.stubEnv('OCR_MODEL', 'test-model')
  })

  it('returns the band, the fields it filled and the updated application', async () => {
    // The shape tasks 12 and 13 read. Nothing else in the suite executes the
    // route's success path at all.
    const id = await newApp()
    const res = await upload(id, { docType: 'drivers_license', imageBase64: WA_PNG })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      band: string
      filled: string[]
      state: ApplicationState
    }

    expect(body.band).toBe('full')
    expect(body.filled).toContain('dl_number')
    expect(body.state.id).toBe(id)
    expect(body.state.fields.dl_number?.value).toBe('WDLJK00580GF')
    expect(body.state.fields.dl_number?.status).toBe('derived')
    expect(body.state.fields.dl_number?.provenance?.source).toBe('ocr')
    expect(body.state.fields.dl_number?.provenance?.box).toHaveLength(4)
    expect(body.state.fields.dl_number?.provenance?.confidence).toBeGreaterThan(0)
  })

  it('persists what it read, rather than only returning it', async () => {
    const id = await newApp()
    await upload(id, { docType: 'drivers_license', imageBase64: WA_PNG })

    const res = await action(id, {
      type: 'CONFIRM', fieldId: 'dl_number', at: AT, shownCopyHash: 'catalog-v1',
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as ApplicationState).fields.dl_number?.status)
      .toBe('confirmed')
  })

  it('409s an application already sent for review, before reading anything', async () => {
    const id = await submittedApp()
    const res = await upload(id, { docType: 'drivers_license', imageBase64: WA_PNG })

    expect(res.status).toBe(409)
    expect(await res.json())
      .toMatchObject({ error: expect.stringMatching(/sent for review/i) })
  })
})

describe('POST /api/application/[id]/documents', () => {
  it('400s a body that is not JSON', async () => {
    expect((await upload(await newApp(), 'not json')).status).toBe(400)
  })

  it('400s a document type outside the accepted set', async () => {
    const res = await upload(await newApp(), {
      docType: 'library_card', imageBase64: pngBase64(1600, 1000),
    })
    expect(res.status).toBe(400)
  })

  it('400s a caller that tries to declare the image size itself', async () => {
    // The size decides the quality band and the position of every crop. It
    // comes off the bytes, and a caller offering one is refused rather than
    // silently ignored.
    const res = await upload(await newApp(), {
      docType: 'drivers_license', imageBase64: pngBase64(320, 200),
      imageSize: { width: 1600, height: 1000 },
    })
    expect(res.status).toBe(400)
  })

  it('400s a data: URL, naming the prefix rather than blaming the image', async () => {
    const res = await upload(await newApp(), {
      docType: 'drivers_license', imageBase64: `data:image/png;base64,${pngBase64(1600, 1000)}`,
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/data:/) })
  })

  it('400s a payload past the size cap at the schema, before it is decoded', async () => {
    const res = await upload(await newApp(), {
      docType: 'drivers_license',
      imageBase64: pngBase64(1600, 1000) + 'A'.repeat(MAX_IMAGE_BASE64_CHARS),
    })

    expect(res.status).toBe(400)
    // The schema's message, not the service's: refused at the wire, so the
    // oversized string is never handed on.
    expect(await res.json()).toMatchObject({ error: 'Malformed document upload' })
  })

  it('400s a payload that is not an image', async () => {
    const res = await upload(await newApp(), {
      docType: 'drivers_license', imageBase64: 'aGVsbG8gd29ybGQ=',
    })
    expect(res.status).toBe(400)
  })

  it('422s a photo below the read floor, before any OCR call', async () => {
    // No OCR_ENDPOINT is set: reaching the provider would throw, so a 422
    // here is also proof the floor is checked first.
    vi.stubEnv('OCR_ENDPOINT', '')
    vi.stubEnv('OCR_MODEL', '')
    const res = await upload(await newApp(), {
      docType: 'drivers_license', imageBase64: pngBase64(320, 200),
    })

    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/too small/i) })
  })

  it('404s an unknown application without spending an OCR call on it', async () => {
    // No endpoint configured, so any read would throw rather than 404.
    vi.stubEnv('OCR_ENDPOINT', '')
    vi.stubEnv('OCR_MODEL', '')
    const res = await upload('no-such-application', {
      docType: 'drivers_license', imageBase64: pngBase64(1600, 1000),
    })
    expect(res.status).toBe(404)
  })

  it('refuses to guess an OCR endpoint when none is configured', async () => {
    vi.stubEnv('OCR_ENDPOINT', '')
    vi.stubEnv('OCR_MODEL', '')
    await expect(upload(await newApp(), {
      docType: 'drivers_license', imageBase64: pngBase64(1600, 1000),
    })).rejects.toThrow(/OCR_ENDPOINT/)
  })
})
