import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.AUDIT_DIGEST_SECRET = 'document-route-test-secret-32-chars!!'

import { POST as CREATE } from '@/app/api/application/route'
import { POST } from '@/app/api/application/[id]/documents/route'
import { __resetAuditLogForTests } from '@/server/audit'
import { __resetStoreForTests } from '@/server/store'
import type { ApplicationState } from '@/domain/application/state'
import { pngBase64 } from '../server/image-bytes'

/**
 * The route is where an unset OCR_ENDPOINT has to be felt: it passes no
 * provider, so the service resolves one from the environment.
 */

function ctx(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function upload(id: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/application/${id}/documents`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    ctx(id),
  )
}

async function newApp(): Promise<string> {
  return ((await (await CREATE()).json()) as ApplicationState).id
}

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
  vi.unstubAllEnvs()
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
