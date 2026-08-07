import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyAction, createApplication } from '@/server/application-service'
import { getAuditLog, __resetAuditLogForTests } from '@/server/audit'
import { ingestDocument, type IngestOutcome } from '@/server/document-service'
import { MAX_IMAGE_BASE64_CHARS } from '@/server/image-size'
import { __resetStoreForTests } from '@/server/store'
import { NO_EVIDENCE, type Candidate } from '@/domain/ocr/extract'
import type { FieldExtractor } from '@/server/ocr/llm-extract'
import type { OcrProvider } from '@/server/ocr/service'
import type { Result } from '@/server/application-service'
import { pngBase64 } from './image-bytes'

const AT = '2026-08-02T00:00:00.000Z'

// Dimensions come off the bytes, so a band is chosen by handing over a real
// header rather than by claiming a size.
const FULL = pngBase64(1600, 1000)
const SMALL = pngBase64(600, 380)
const TINY = pngBase64(320, 200)

/** One markdown read: the text feeds the extractor, stubbed below. */
function providerFor(text = ''): OcrProvider {
  return async () => ({ text })
}

const candidate = (key: string, raw: string): Candidate => ({
  key, raw, evidence: { ...NO_EVIDENCE },
})

/** What the LLM extraction step answers; stubbed, the model is not under test here. */
const extractorFor = (candidates: readonly Candidate[]): FieldExtractor =>
  async () => candidates

const provider = providerFor()
const extractor = extractorFor([
  candidate('dl_number', 'WDLJK00580GF'),
  candidate('dob', '1982-04-17'),
])

/** Fails loudly instead of returning early, which would pass vacuously. */
function unwrap(result: Result<IngestOutcome>): IngestOutcome {
  if (!result.ok) {
    throw new Error(`ingest failed: ${result.failure.kind} — ${result.failure.message}`)
  }
  return result.value
}

/** An application as its owner holds it: the id, and the token that opens it. */
type Owned = { id: string; ownerToken: string | null }

/** Answers everything an individual owes, then sends it for review. */
function submit(app: Owned): void {
  const answers: [string, unknown][] = [
    ['applicant_type', 'individual'], ['location_country', 'USA'],
    ['location_state', 'GA'], ['id_form', 'drivers_license'],
    ['address_differs', 'no'], ['wants_gsa', 'no'],
    ['primary_activity', 'dealer'], ['preferred_language', 'English'],
    ['first_name', 'Ada'], ['last_name', 'Lovelace'], ['dl_number', 'D1234567'],
    ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'], ['id_images', ['front.png']],
    ['id_country', 'USA'], ['id_state', 'GA'],
    ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
    ['addr_state', 'GA'], ['addr_zip', '30301'],
    ['phone_primary', '4045551234'], ['phone_mobile', '4045551234'],
  ]
  for (const [fieldId, value] of answers) {
    const result = applyAction(app.id, app.ownerToken, {
      type: 'SET_VALUE', fieldId, value, source: 'user', at: AT,
    })
    expect(result.ok, fieldId).toBe(true)
  }
  expect(applyAction(app.id, app.ownerToken, { type: 'SUBMIT', at: AT }).ok).toBe(true)
}

function ingest(
  app: Owned,
  imageBase64: string,
  ocr: OcrProvider = provider,
  extract: FieldExtractor = extractor,
) {
  return ingestDocument({
    applicationId: app.id,
    ownerToken: app.ownerToken,
    docType: 'drivers_license',
    imageBase64,
    at: AT,
    provider: ocr,
    extractor: extract,
  })
}

beforeEach(() => {
  __resetStoreForTests()
  __resetAuditLogForTests()
})

describe('ingestDocument', () => {
  it('fills fields from a full-resolution card and marks them derived', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL))

    expect(outcome.band).toBe('text-only')
    expect(outcome.filled).toContain('dl_number')
    expect(outcome.filled).toContain('dob')

    const field = outcome.state.fields.dl_number
    expect(field?.value).toBe('WDLJK00580GF')
    // Derived, never confirmed: the applicant still has to look at it.
    expect(field?.status).toBe('derived')
    expect(field?.provenance?.source).toBe('ocr')
    expect(field?.provenance?.documentId).toBeTruthy()
  })

  it('files every field of one upload under the same document id', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL))
    const ids = outcome.filled.map((key) => outcome.state.fields[key]?.provenance?.documentId)

    expect(new Set(ids).size).toBe(1)
  })

  it('hands back the id it filed those fields under, not one of its own', async () => {
    // Every field of one upload is filed under the same id, and that id is the
    // one handed back — not a freshly minted one the caller never saw.
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL))

    expect(outcome.filled.length).toBeGreaterThan(0)
    for (const key of outcome.filled) {
      expect(outcome.state.fields[key]?.provenance?.documentId, key)
        .toBe(outcome.documentId)
    }
  })

  it('files a read with ocr provenance and a confidence score', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL))

    const provenance = outcome.state.fields.dl_number?.provenance
    expect(provenance?.source).toBe('ocr')
    expect(provenance?.documentId).toBe(outcome.documentId)
    expect(provenance?.confidence).toBeGreaterThan(0)
  })

  it('reads at text-only whatever the pixel width, above the re-take floor', async () => {
    // Mistral OCR returns markdown without bounding boxes, so every legible
    // read is text-only — a full-size photo and a 600px one land in the same band.
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL))

    expect(outcome.band).toBe('text-only')
    expect(outcome.filled).toContain('dl_number')
  })

  it('reads at text-only for a medium photo too', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, SMALL))

    expect(outcome.band).toBe('text-only')
    expect(outcome.filled).toContain('dl_number')
  })

  it('refuses to call OCR below the read floor, and writes nothing', async () => {
    let called = false
    const app = createApplication()
    const result = await ingest(app, TINY, async () => {
      called = true
      return { text: '' }
    })

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('rejected')
    expect(result.failure.message).toMatch(/too small/i)
    expect(getAuditLog().sizeFor(app.id)).toBe(0)
  })

  it('refuses an upload to an application already sent for review', async () => {
    // Every other write path answers 409 once submittedAt is set. Taking a
    // document here, filling nothing and answering 200 tells an applicant
    // their ID was accepted onto a record that cannot change.
    let called = false
    const app = createApplication()
    submit(app)

    const result = await ingest(app, FULL, async () => {
      called = true
      return { text: '' }
    })

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('submitted')
    expect(result.failure.message).toMatch(/sent for review/i)
  })

  it('refuses a data: URL rather than reading it as a broken image', async () => {
    // canvas.toDataURL() hands the client one of these. The message has to
    // name the prefix, or a perfectly good PNG reads as "not an image".
    const app = createApplication()
    const result = await ingest(app, `data:image/png;base64,${FULL}`)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed')
    expect(result.failure.message).toMatch(/data:/)
  })

  it('refuses an oversized payload before allocating it', async () => {
    // A payload that would otherwise read fine: the cap is what refuses it,
    // not the header parser giving up on garbage.
    const app = createApplication()
    const result = await ingest(app, FULL + 'A'.repeat(MAX_IMAGE_BASE64_CHARS))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.message).toMatch(/too large/i)
  })

  it('refuses a payload that is not an image it can measure', async () => {
    let called = false
    const app = createApplication()
    const result = await ingest(app, 'not-an-image', async () => {
      called = true
      return { text: '' }
    })

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed')
  })

  it('attaches a confidence to every field it fills', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL))

    expect(outcome.filled.length).toBeGreaterThan(0)
    for (const key of outcome.filled) {
      const confidence = outcome.state.fields[key]?.provenance?.confidence
      expect(confidence, key).toBeGreaterThan(0)
      expect(confidence, key).toBeLessThanOrEqual(1)
    }
  })

  it('fills nothing and fails nothing when the read yields no fields, but still records the upload', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(
      app, FULL,
      providerFor('NOTHING USEFUL'),
      extractorFor([]),
    ))

    expect(outcome.filled).toEqual([])
    expect(outcome.state.id).toBe(app.id)
    // No SET_VALUE fired — nothing was legible — but the document itself was
    // still handed over and accepted, so it must count as held: an applicant
    // who photographed an unreadable licence must not be asked to
    // photograph it again forever. presentPlan still runs — reading nothing
    // is not a reason to strand the applicant with no group on screen — so a
    // second entry (the group it presents) is on the trail too.
    expect(getAuditLog().sizeFor(app.id)).toBe(2)
    expect(getAuditLog().entriesFor(app.id)[0]?.kind).toBe('document_recorded')
    expect(getAuditLog().entriesFor(app.id)[1]?.kind).toBe('agent_turn')
    expect(outcome.state.documents).toEqual([
      { documentId: outcome.documentId, docType: 'drivers_license', at: AT },
    ])
  })

  it('404s an application that does not exist, even when it read nothing', async () => {
    const result = await ingest({ id: 'no-such-application', ownerToken: 'any-token' }, FULL, providerFor())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unknown')
  })

  it('keeps the fields the engine accepts when it refuses one of them', async () => {
    // An applicant who declared a state ID and uploaded a licence: dl_number
    // is not part of their application, dob still is.
    const app = createApplication()
    const updated = applyAction(app.id, app.ownerToken, {
      type: 'UPDATE_PROFILE', patch: { idForm: 'state_id' }, at: AT,
    })
    expect(updated.ok).toBe(true)

    const outcome = unwrap(await ingest(app, FULL))

    expect(outcome.filled).not.toContain('dl_number')
    expect(outcome.filled).toContain('dob')
    expect(outcome.state.fields.dob?.value).toBe('1982-04-17')
    expect(outcome.state.fields.dl_number).toBeUndefined()
  })

  it('never writes the image anywhere it can be read back', async () => {
    const app = createApplication()
    // A payload that measures as a real image and carries a findable marker.
    const marked = `${FULL}SECRET-IMAGE-BYTES`
    const outcome = unwrap(await ingest(app, marked))

    expect(outcome.filled.length).toBeGreaterThan(0)
    expect(JSON.stringify(outcome.state)).not.toContain('SECRET-IMAGE-BYTES')
    // The audit log is append-only and outlives the request. Document bytes in
    // it would be the one copy nobody remembers to delete.
    expect(JSON.stringify(getAuditLog().entries())).not.toContain('SECRET-IMAGE-BYTES')
    expect(getAuditLog().sizeFor(app.id)).toBeGreaterThan(0)
  })
})

describe('ingestDocument — a recorded read of a real specimen', () => {
  const fixture = JSON.parse(
    readFileSync('sample/licenses/fixtures/wa_enhanced.json', 'utf8'),
  ) as {
    imageSize: { width: number; height: number }
    text: string
  }

  const realImage = readFileSync('sample/licenses/specimens/wa_enhanced.png').toString('base64')

  // Mistral OCR returns markdown without bounding boxes.
  const recorded: OcrProvider = async () => ({ text: fixture.text })

  // What the LLM extraction step answers for this card.
  const extracted = extractorFor([
    candidate('dl_number', 'WDLJK00580GF'),
    candidate('first_name', 'JANE'),
    candidate('last_name', 'SAMPLE'),
    candidate('dob', '1982-04-17'),
    candidate('addr_line1', '123 STREET ADDRESS'),
    candidate('addr_city', 'YOUR CITY'),
    candidate('addr_zip', '99999-0000'),
  ])

  it('reads the Washington card end to end, from bytes to derived fields', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, realImage, recorded, extracted))

    // 1560px wide, read off the PNG itself — and text-only, since a Mistral
    // read is markdown only.
    expect(outcome.band).toBe('text-only')
    expect(outcome.filled.length).toBeGreaterThanOrEqual(7)
    expect(outcome.filled).toContain('dl_number')
    expect(outcome.state.fields.dl_number?.value).toBe('WDLJK00580GF')
    expect(outcome.state.fields.addr_line1?.value).toBe('123 STREET ADDRESS')
    expect(outcome.state.fields.addr_city?.value).toBe('YOUR CITY')
    expect(outcome.state.fields.addr_zip?.value).toBe('99999-0000')

    for (const key of outcome.filled) {
      const field = outcome.state.fields[key]
      expect(field?.status, key).toBe('derived')
      expect(field?.provenance?.source, key).toBe('ocr')
      expect(field?.provenance?.confidence, key).toBeGreaterThan(0)
      expect(field?.provenance?.confidence, key).toBeLessThanOrEqual(1)
    }
  })

  it('reads the same card from a JPEG re-encode, which is what a phone sends', async () => {
    // Same pixels, a different container. Nothing downstream of the header
    // read should be able to tell, and every specimen in the corpus is a PNG.
    const jpeg = readFileSync('sample/licenses/encodings/wa_enhanced.jpg').toString('base64')
    const app = createApplication()
    const fromJpeg = unwrap(await ingest(app, jpeg, recorded, extracted))

    __resetStoreForTests()
    const other = createApplication()
    const fromPng = unwrap(await ingest(other, realImage, recorded, extracted))

    expect(fromJpeg.band).toBe(fromPng.band)
    expect(fromJpeg.filled).toEqual(fromPng.filled)
  })
})
