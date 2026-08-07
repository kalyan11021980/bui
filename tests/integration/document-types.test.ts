import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyAction, createApplication } from '@/server/application-service'
import { ingestDocument, type IngestOutcome } from '@/server/document-service'
import { __resetStoreForTests } from '@/server/store'
import { NO_EVIDENCE, type Candidate } from '@/domain/ocr/extract'
import type { DocType } from '@/domain/field-id'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { OcrProvider } from '@/server/ocr/service'
import type { FieldExtractor } from '@/server/ocr/llm-extract'

/**
 * Every document type the route accepts, ingested end to end through the real
 * ingestDocument. The OCR read and the LLM extraction are stubbed: the model
 * is not under test here, the catalog routing and the profile gate are. What a
 * document may prove is still the catalog's call, asserted through the
 * extractor each card is handed, and what an applicant is asked is the
 * requirements engine's, asserted through the profile.
 *
 * ingestDocument is imported, not re-implemented: a dropped wiring call on
 * that path would leave every test here filling nothing, so a green run is
 * proof the read -> extract -> validate -> commit -> present pipeline is
 * still connected.
 */

const AT = '2026-08-02T00:00:00.000Z'

type Fixture = {
  docType: DocType
  image: string
  text: string
}

const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(`sample/licenses/fixtures/${name}.json`, 'utf8')) as Fixture

/** One Mistral markdown read: text in. */
function recorded(card: Fixture): OcrProvider {
  return async () => ({ text: card.text })
}

const candidate = (key: string, raw: string): Candidate =>
  ({ key, raw, evidence: { ...NO_EVIDENCE } })

/** What the LLM extraction step answers; stubbed, the model is not under test. */
const extractorFor = (candidates: readonly Candidate[]): FieldExtractor =>
  async () => candidates

async function ingest(
  card: Fixture,
  profile: Partial<ApplicantProfile>,
  extracted: readonly Candidate[],
): Promise<IngestOutcome> {
  const app = createApplication()
  const updated = applyAction(app.id, app.ownerToken, {
    type: 'UPDATE_PROFILE', patch: profile, at: AT,
  })
  expect(updated.ok, 'profile').toBe(true)

  const result = await ingestDocument({
    applicationId: app.id,
    ownerToken: app.ownerToken,
    docType: card.docType,
    imageBase64: readFileSync(card.image).toString('base64'),
    at: AT,
    provider: recorded(card),
    extractor: extractorFor(extracted),
  })
  if (!result.ok) {
    throw new Error(`ingest failed: ${result.failure.kind} — ${result.failure.message}`)
  }
  return result.value
}

beforeEach(() => { __resetStoreForTests() })

describe('every document type the route accepts', () => {
  it('fills a driver’s licence through the markdown read', async () => {
    const outcome = await ingest(fixture('wa_enhanced'), { idForm: 'drivers_license' }, [
      candidate('dl_number', 'WDLJK00580GF'),
      candidate('first_name', 'JANE'),
      candidate('last_name', 'SAMPLE'),
      candidate('dob', '1982-04-17'),
    ])

    expect(outcome.filled).toEqual(expect.arrayContaining([
      'dl_number', 'first_name', 'last_name', 'dob',
    ]))
  })

  it('fills a passport through the markdown read', async () => {
    const outcome = await ingest(fixture('nl_passport_2014'), { idForm: 'passport' }, [
      candidate('passport_number', 'AB1234567'),
      candidate('first_name', 'ANNA'),
      candidate('last_name', 'DE VRIES'),
      candidate('dob', '1980-03-15'),
      candidate('id_country', 'NLD'),
    ])

    expect(outcome.filled).toContain('passport_number')
    expect(outcome.filled).toContain('dob')
  })

  it('reads a state ID as an id_number, never as a licence number', async () => {
    // The model offers both numbers; the profile decides which one this
    // applicant owes. A state-ID profile asks for id_number and refuses
    // dl_number, so only the former lands. This is the end-to-end proof that
    // the catalog's derivableFrom routing still holds through the new pipeline.
    const outcome = await ingest(fixture('ca_id_2010'), { idForm: 'state_id' }, [
      candidate('id_number', 'D1234567'),
      candidate('dl_number', 'D1234567'),
    ])

    expect(outcome.filled).toContain('id_number')
    expect(outcome.filled).not.toContain('dl_number')
  })

  it('fills a dealer licence for a business that owes one', async () => {
    const outcome = await ingest(
      fixture('dealer_license'),
      { applicantType: 'business', licenses: ['dealer'], state: 'GA' },
      [candidate('license_number#0', 'DLR-12345')],
    )

    expect(outcome.filled).toContain('license_number#0')
  })

  it('fills nothing from a dealer licence against an individual profile', async () => {
    // The profile is load-bearing, not scenery: the requirements engine
    // refuses every field it does not ask this applicant for, so a dealer
    // licence read against an individual fills nothing however well it was read.
    const outcome = await ingest(
      fixture('dealer_license'),
      { applicantType: 'individual', idForm: 'drivers_license' },
      [candidate('license_number#0', 'DLR-12345')],
    )

    expect(outcome.filled).toEqual([])
  })

  it('takes a proof of residency and deliberately fills nothing from it', async () => {
    // The architectural zero, pinned on purpose. Nothing in the catalog is
    // derivable from a utility bill, so the extractor offers nothing and the
    // upload records the document without filling a field. The contract that
    // nothing is derivable is enforced in llm-extract's allowed filter (unit
    // tested); this is the end-to-end proof the upload still lands on the record.
    const outcome = await ingest(fixture('chicago_utility_bill'), {
      addressDiffersFromId: true,
    }, [])

    expect(outcome.filled).toEqual([])
    expect(outcome.state.documents).toHaveLength(1)
  })
})