import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetAuditLogForTests } from '@/server/audit'
import { __resetStoreForTests } from '@/server/store'
import type { OcrProvider } from '@/server/ocr/service'
import { pngBase64 } from './image-bytes'

const AT = '2026-08-02T00:00:00.000Z'
const FULL = pngBase64(1600, 1000)

// Only APPEND_TURN throws — RECORD_DOCUMENT and SET_VALUE go through the
// real reducer, so the upload itself still succeeds normally. This is the
// commit presentPlan makes, isolated from every other write on the path.
vi.mock('@/domain/application/reducer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/application/reducer')>()
  return {
    ...actual,
    applicationReducer: (state: unknown, action: { type: string }) => {
      if (action.type === 'APPEND_TURN') throw new Error('reducer boom')
      return actual.applicationReducer(state as never, action as never)
    },
  }
})

describe('presentPlan, reached through ingestDocument — a throw must not 500 a successful upload', () => {
  beforeEach(() => {
    __resetStoreForTests()
    __resetAuditLogForTests()
  })

  it('still answers ok, carrying the pre-presentation state, when presentPlan’s own commit throws', async () => {
    const { createApplication } = await import('@/server/application-service')
    const { ingestDocument } = await import('@/server/document-service')

    const app = createApplication()
    const emptyRead: OcrProvider = async () => ({ text: '' })

    const outcome = await ingestDocument({
      applicationId: app.id,
      ownerToken: app.ownerToken,
      docType: 'drivers_license',
      imageBase64: FULL,
      at: AT,
      provider: emptyRead,
      // The read is empty, so extraction returns nothing; presentPlan is the
      // only thing left that can throw, which is what this test isolates.
      extractor: async () => [],
    })

    // The upload itself is not what threw — RECORD_DOCUMENT already
    // committed before presentPlan ever runs — so this must not fail.
    if (!outcome.ok) {
      throw new Error(`expected the upload to still succeed: ${outcome.failure.message}`)
    }
    // presentPlan's own commit is what threw, so the state it hands back
    // is the pre-presentation one: no turn was appended.
    expect(outcome.value.state.transcript).toEqual([])
  })
})
