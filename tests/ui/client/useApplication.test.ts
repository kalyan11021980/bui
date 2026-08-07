import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useApplication } from '@/ui/client/useApplication'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { PreparedImage } from '@/ui/panel/prepare-image'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  bizCountry: null,
}

const IMAGE: PreparedImage = {
  imageBase64: 'aGk=', imageUrl: 'data:image/png;base64,aGk=',
  imageSize: { width: 1600, height: 1000 },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

/** Start answers at once; each document read stays open until the test settles it. */
let settleRead: Array<(r: Response) => void>

function stubFetch(state: unknown) {
  settleRead = []
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/documents')) {
      return new Promise<Response>((resolve) => { settleRead.push(resolve) })
    }
    return Promise.resolve(json(state))
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('useApplication readingDocTypes', () => {
  it('lists a doc type for exactly its in-flight window', async () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    stubFetch(state)
    const { result } = renderHook(() => useApplication())
    await waitFor(() => expect(result.current.state).not.toBeNull())

    expect(result.current.readingDocTypes).toEqual([])
    act(() => { result.current.readDocument('drivers_license', IMAGE) })
    await waitFor(() =>
      expect(result.current.readingDocTypes).toEqual(['drivers_license']))

    act(() => {
      settleRead[0]!(json({ band: 'text-only', documentId: 'doc-1', filled: [], state }))
    })
    await waitFor(() => expect(result.current.readingDocTypes).toEqual([]))
  })

  it('keeps a second read listed while the first settles', async () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    stubFetch(state)
    const { result } = renderHook(() => useApplication())
    await waitFor(() => expect(result.current.state).not.toBeNull())

    act(() => {
      result.current.readDocument('drivers_license', IMAGE)
      result.current.readDocument('dealer_license', IMAGE)
    })
    await waitFor(() => expect(result.current.readingDocTypes)
      .toEqual(['drivers_license', 'dealer_license']))

    act(() => {
      settleRead[0]!(json({ band: 'text-only', documentId: 'doc-1', filled: [], state }))
    })
    await waitFor(() =>
      expect(result.current.readingDocTypes).toEqual(['dealer_license']))
  })

  it('drops the doc type when the read fails, too', async () => {
    const state = createApplication('app-1', PROFILE, 'owner-1')
    stubFetch(state)
    const { result } = renderHook(() => useApplication())
    await waitFor(() => expect(result.current.state).not.toBeNull())

    act(() => { result.current.readDocument('drivers_license', IMAGE) })
    await waitFor(() =>
      expect(result.current.readingDocTypes).toEqual(['drivers_license']))

    act(() => { settleRead[0]!(json({ error: 'nope' }, 502)) })
    await waitFor(() => expect(result.current.readingDocTypes).toEqual([]))
  })
})
