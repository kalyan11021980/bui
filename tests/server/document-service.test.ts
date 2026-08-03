import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyAction, createApplication } from '@/server/application-service'
import { getAuditLog, __resetAuditLogForTests } from '@/server/audit'
import { QUIET_THRESHOLD } from '@/domain/ocr/confidence'
import { ingestDocument, type IngestOutcome } from '@/server/document-service'
import { MAX_IMAGE_BASE64_CHARS } from '@/server/image-size'
import { __resetStoreForTests } from '@/server/store'
import type { Detection } from '@/domain/ocr/grounding'
import type { OcrProvider } from '@/server/ocr/service'
import type { Result } from '@/server/application-service'
import { pngBase64 } from './image-bytes'

/**
 * Nothing here imports a strategy module. The service has to register them
 * itself — importing `@/domain/ocr/extract/aamva` from the test would hide a
 * missing import that leaves the running server reading nothing at all.
 */

const AT = '2026-08-02T00:00:00.000Z'

// Dimensions come off the bytes, so a band is chosen by handing over a real
// header rather than by claiming a size.
const FULL = pngBase64(1600, 1000)
const SMALL = pngBase64(600, 380)
const TINY = pngBase64(320, 200)

const det = (text: string, box: [number, number, number, number]): Detection =>
  ({ text, box })

/** A card filling the frame: 60-940 of 1000 is 1408px at 1600 wide. */
const CARD: Detection[] = [
  det('4dLIC#WDLJK00580GF', [60, 200, 940, 240]),
  det('3DOB04/17/1982', [60, 300, 940, 340]),
]

const grounded = (detections: readonly Detection[]): string =>
  detections
    .map((d) => `<|ref|>${d.text}<|/ref|><|det|>[[${d.box.join(',')}]]<|/det|>`)
    .join('')

/** Two passes, as the real transport makes them: grounded, then plain. */
function providerFor(detections: readonly Detection[], plain: string): OcrProvider {
  return async ({ prompt }) =>
    prompt.includes('grounding')
      ? { text: grounded(detections), detections }
      : { text: plain, detections: [] }
}

const provider = providerFor(CARD, 'WDLJK00580GF 04/17/1982')

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
    ['primary_activity', 'dealer'], ['preferred_language', 'English'],
    ['first_name', 'Ada'], ['last_name', 'Lovelace'], ['dl_number', 'D1234567'],
    ['dl_expiry', '2030-04-30'], ['dob', '1982-08-31'], ['id_images', ['front.png']],
    ['id_country', 'US'], ['id_state', 'GA'],
    ['addr_line1', '2345 Anywhere St'], ['addr_city', 'Atlanta'],
    ['addr_state', 'GA'], ['addr_zip', '30301'], ['phone_mobile', '4045551234'],
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
) {
  return ingestDocument({
    applicationId: app.id,
    ownerToken: app.ownerToken,
    docType: 'drivers_license',
    imageBase64,
    at: AT,
    provider: ocr,
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

    expect(outcome.band).toBe('full')
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

  it('records a box in original-image pixels when the band allows crops', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL))

    // [60,200,940,240] of 1000, stretched onto 1600x1000. Asserted as the
    // exact rectangle: a crop that is merely "wider than it is tall" would
    // still be the wrong part of the card.
    expect(outcome.state.fields.dl_number?.provenance?.box).toEqual([96, 200, 1504, 240])
  })

  it('suppresses boxes in the text-only band but still fills the fields', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, SMALL))

    expect(outcome.band).toBe('text-only')
    expect(outcome.filled).toContain('dl_number')
    expect(outcome.state.fields.dl_number?.provenance?.box).toBeUndefined()
  })

  it('suppresses boxes for a big photo of a small card, whatever its pixel width', async () => {
    // Reads fine at 1600px wide; the card covers 200/1000 of the frame, so
    // localisation is no better than a 320px photo of a card filling it.
    const distant = providerFor(
      [det('4dLIC#WDLJK00580GF', [400, 200, 600, 240])],
      'WDLJK00580GF',
    )
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL, distant))

    expect(outcome.band).toBe('text-only')
    expect(outcome.filled).toContain('dl_number')
    expect(outcome.state.fields.dl_number?.provenance?.box).toBeUndefined()
  })

  it('records no box for a detection covering the whole card', async () => {
    // A box that size is a detection failure wearing a box. Cropping to it
    // asserts the value came from a region it did not.
    const wide = providerFor(
      [
        det('4dLIC#WDLJK00580GF', [0, 0, 1000, 1000]),
        det('3DOB04/17/1982', [60, 300, 940, 340]),
      ],
      'WDLJK00580GF 04/17/1982',
    )
    const app = createApplication()
    const outcome = unwrap(await ingest(app, FULL, wide))

    expect(outcome.band).toBe('full')
    expect(outcome.filled).toContain('dl_number')
    expect(outcome.state.fields.dl_number?.provenance?.box).toBeUndefined()
    // The plausible one beside it is still recorded, so this is a per-box
    // decision rather than the band being demoted underneath it.
    expect(outcome.state.fields.dob?.provenance?.box).toBeDefined()
  })

  it('refuses to call OCR below the read floor, and writes nothing', async () => {
    let called = false
    const app = createApplication()
    const result = await ingest(app, TINY, async () => {
      called = true
      return { text: '', detections: [] }
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
      return { text: '', detections: [] }
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
      return { text: '', detections: [] }
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

  it('scores a cross-pass agreement above a cross-pass silence', async () => {
    // Wires the confidence scorer to the second pass. Same card, same boxes;
    // only the plain read differs.
    const app = createApplication()
    const agreed = unwrap(await ingest(app, FULL))

    __resetStoreForTests()
    const other = createApplication()
    const silent = unwrap(await ingest(other, FULL, providerFor(CARD, '')))

    const score = (o: IngestOutcome) => o.state.fields.dl_number?.provenance?.confidence ?? 0
    expect(score(agreed)).toBeGreaterThan(score(silent))
  })

  it('fills nothing and fails nothing when the read yields no fields', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(
      app, FULL,
      providerFor([det('NOTHINGUSEFUL', [60, 200, 940, 240])], 'NOTHING USEFUL'),
    ))

    expect(outcome.filled).toEqual([])
    expect(outcome.state.id).toBe(app.id)
    // Nothing happened, so nothing is claimed to have happened. A no-op
    // action here would put an event in an append-only compliance record.
    expect(getAuditLog().sizeFor(app.id)).toBe(0)
  })

  it('404s an application that does not exist, even when it read nothing', async () => {
    const result = await ingest({ id: 'no-such-application', ownerToken: 'any-token' }, FULL, providerFor([], ''))
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
    plainText: string
    detections: Detection[]
  }

  const realImage = readFileSync('sample/licenses/specimens/wa_enhanced.png').toString('base64')

  const recorded: OcrProvider = async ({ prompt }) =>
    prompt.includes('grounding')
      ? { text: fixture.text, detections: fixture.detections }
      : { text: fixture.plainText, detections: [] }

  it('reads the Washington card end to end, from bytes to derived fields', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, realImage, recorded))

    // 1560px wide, read off the PNG itself, with the card filling the frame.
    expect(outcome.band).toBe('full')
    expect(outcome.filled.length).toBeGreaterThanOrEqual(9)
    expect([...outcome.filled].sort()).toContain('dl_number')
    expect(outcome.state.fields.dl_number?.value).toBe('WDLJK00580GF')
    expect(outcome.state.fields.addr_zip?.value).toBe('99999-0000')

    for (const key of outcome.filled) {
      expect(outcome.state.fields[key]?.status, key).toBe('derived')
      expect(outcome.state.fields[key]?.provenance?.source, key).toBe('ocr')
      expect(outcome.state.fields[key]?.provenance?.confidence, key).toBeGreaterThan(0)
    }
  })

  it('re-spaces the address end to end, and scores agreement on the spaced value', async () => {
    // Guards the wiring and its order, not the algorithm. ingestDocument must
    // compose respaceAddresses *then* withCrossPass — dropping the call
    // entirely, or running it after cross-pass is scored, both leave the
    // value looking right. Only the confidence tells them apart: scoring
    // cross-pass against the still-space-stripped value caps it below
    // QUIET_THRESHOLD even once the display value has been re-spaced, so a
    // value-only assertion cannot see either failure — see
    // document-service.ts.
    const app = createApplication()
    const outcome = unwrap(await ingest(app, realImage, recorded))
    const line1 = outcome.state.fields.addr_line1
    const city = outcome.state.fields.addr_city

    expect(line1?.value).toBe('123 STREET ADDRESS')
    expect(city?.value).toBe('YOUR CITY')
    expect(line1?.provenance?.confidence).toBeGreaterThanOrEqual(QUIET_THRESHOLD)
    expect(city?.provenance?.confidence).toBeGreaterThanOrEqual(QUIET_THRESHOLD)
  })

  it('maps the licence number onto the pixels it was printed at', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, realImage, recorded))
    const box = outcome.state.fields.dl_number?.provenance?.box

    // The whole chain in one number: PNG header to 1560x1006, grounded box
    // 339-694 of 1000, stretched. Nothing else in the suite crosses all of it.
    expect(box?.map(Math.round)).toEqual([529, 242, 1083, 292])
  })

  it('reads the same card from a JPEG re-encode, which is what a phone sends', async () => {
    // Same pixels, a different container. Nothing downstream of the header
    // read should be able to tell, and every specimen in the corpus is a PNG.
    const jpeg = readFileSync('sample/licenses/encodings/wa_enhanced.jpg').toString('base64')
    const app = createApplication()
    const fromJpeg = unwrap(await ingest(app, jpeg, recorded))

    __resetStoreForTests()
    const other = createApplication()
    const fromPng = unwrap(await ingest(other, realImage, recorded))

    expect(fromJpeg.band).toBe(fromPng.band)
    expect(fromJpeg.filled).toEqual(fromPng.filled)
    expect(fromJpeg.state.fields.dl_number?.provenance?.box)
      .toEqual(fromPng.state.fields.dl_number?.provenance?.box)
  })

  it('places every recorded box inside the image it came from', async () => {
    const app = createApplication()
    const outcome = unwrap(await ingest(app, realImage, recorded))
    const boxes = outcome.filled
      .map((key) => outcome.state.fields[key]?.provenance?.box)
      .filter((box): box is readonly [number, number, number, number] => box !== undefined)

    expect(boxes.length).toBeGreaterThan(0)
    for (const [x0, y0, x1, y1] of boxes) {
      expect(x1).toBeGreaterThan(x0)
      expect(y1).toBeGreaterThan(y0)
      expect(x1).toBeLessThanOrEqual(fixture.imageSize.width)
      expect(y1).toBeLessThanOrEqual(fixture.imageSize.height)
    }
  })
})
