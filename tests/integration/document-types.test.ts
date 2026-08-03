import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyAction, createApplication } from '@/server/application-service'
import { ingestDocument } from '@/server/document-service'
import { __resetStoreForTests } from '@/server/store'
import type { Detection } from '@/domain/ocr/grounding'
import type { DocType } from '@/domain/field-id'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { OcrProvider } from '@/server/ocr/service'

/**
 * Every document type the route accepts, ingested end to end against a
 * recorded read of a real specimen.
 *
 * Nothing here imports a strategy module, and nothing may. Each strategy
 * registers itself as an import side effect of document-service; importing
 * one into this file registers it in this file's module graph instead —
 * vitest isolates registries per file — and a dropped import in
 * document-service would leave the running server reading nothing while
 * every test here stayed green.
 *
 * Assertions are on fields actually filled. "The strategy ran" is not the
 * claim; "a passport upload fills the applicant's form" is.
 */

const AT = '2026-08-02T00:00:00.000Z'

type Fixture = {
  docType: DocType
  image: string
  imageSize: { width: number; height: number }
  text: string
  plainText: string
  detections: Detection[]
}

const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(`sample/licenses/fixtures/${name}.json`, 'utf8')) as Fixture

/** The two passes as the real transport makes them: grounded, then plain. */
function recorded(card: Fixture): OcrProvider {
  return async ({ prompt }) =>
    prompt.includes('grounding')
      ? { text: card.text, detections: card.detections }
      : { text: card.plainText, detections: [] }
}

/**
 * The profile is load-bearing, not scenery: the requirements engine refuses
 * every field it does not ask this applicant for, so a dealer licence read
 * against an individual's profile fills nothing however well it was read.
 */
async function ingest(card: Fixture, profile: Partial<ApplicantProfile>) {
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
  })
  if (!result.ok) {
    throw new Error(`ingest failed: ${result.failure.kind} — ${result.failure.message}`)
  }
  return result.value
}

beforeEach(() => { __resetStoreForTests() })

describe('every document type the route accepts', () => {
  it('reads a driver’s licence through the AAMVA strategy', async () => {
    const outcome = await ingest(fixture('wa_enhanced'), { idForm: 'drivers_license' })

    expect(outcome.filled).toContain('dl_number')
    expect(outcome.filled.length).toBeGreaterThanOrEqual(9)
  })

  it('reads a passport through the MRZ strategy', async () => {
    const outcome = await ingest(fixture('nl_passport_2014'), { idForm: 'passport' })

    expect(outcome.filled).toContain('dob')
    expect(outcome.filled.length).toBeGreaterThanOrEqual(5)
  })

  it('reads a state ID as an id_number, never as a licence number', async () => {
    // Also the only end-to-end proof that the catalog's derivableFrom routing
    // holds: the strategy reads the number, the catalog decides its name.
    const outcome = await ingest(fixture('ca_id_2010'), { idForm: 'state_id' })

    expect(outcome.filled).toContain('id_number')
    expect(outcome.filled).not.toContain('dl_number')
  })

  it('reads a dealer licence through the labelled strategy', async () => {
    const outcome = await ingest(fixture('dealer_license'), {
      applicantType: 'business', licenses: ['dealer'], state: 'GA',
    })

    expect(outcome.filled).toContain('license_number#0')
    expect(outcome.filled.length).toBeGreaterThanOrEqual(4)
  })

  it('takes a proof of residency and deliberately fills nothing from it', async () => {
    // The architectural zero, pinned on purpose. Nothing in the catalog is
    // derivable from a utility bill, so this must fail loudly the day someone
    // adds a derivableFrom without thinking through what a bill may assert
    // about the person holding it.
    const outcome = await ingest(fixture('chicago_utility_bill'), {
      addressDiffersFromId: true,
    })

    expect(outcome.filled).toEqual([])
  })
})
