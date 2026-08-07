import { randomUUID } from 'node:crypto'
import { submittedRefusal } from '@/domain/application/guards'
import { scoreEvidence } from '@/domain/ocr/confidence'
import { parseCandidates } from '@/domain/ocr/extract'
import { bandForWidth, type QualityBand } from '@/domain/ocr/quality'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { applyAction, getApplication, presentPlan, type Result } from './application-service'
import { failure } from './http'
import { imageSizeOf, MAX_IMAGE_BASE64_CHARS } from './image-size'
import { envExtractor, type FieldExtractor } from './ocr/llm-extract'
import { readDocument, type OcrProvider } from './ocr/service'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import type { RequirementKey } from '@/domain/requirements/key'

export type IngestInput = {
  readonly applicationId: string
  /** From the request header. An id alone does not open an application. */
  readonly ownerToken: string | null
  readonly docType: DocType
  /** Bare base64 payload, no `data:` prefix. Held for the call and discarded. */
  readonly imageBase64: string
  readonly at: string
  readonly provider?: OcrProvider
  readonly extractor?: FieldExtractor
}

export type IngestOutcome = {
  readonly band: QualityBand
  /** What this upload was filed as. */
  readonly documentId: string
  readonly filled: readonly RequirementKey[]
  readonly state: ApplicationState
}

const UNREADABLE = 'Upload a PNG or JPEG photo of the document.'
const TOO_LARGE = 'That image is too large. Send one under 8 MB.'
const DATA_URL =
  'Send the base64 payload on its own, without the data: prefix a canvas puts in front of it.'

export async function ingestDocument(
  input: IngestInput,
): Promise<Result<IngestOutcome>> {
  // Before the read: an application that does not exist, one the caller does
  // not hold the token for, or one already sent for review cannot be told
  // anything — and an OCR read plus an extraction call on its behalf is
  // spent for nothing.
  const existing = getApplication(input.applicationId, input.ownerToken)
  if (!existing.ok) return existing

  // Every other write path refuses a submitted application. Accepting an
  // upload here, filling nothing and answering 200 would tell an applicant
  // their document was taken when the record cannot change.
  const closed = submittedRefusal(existing.value)
  if (closed !== null) return { ok: false, failure: failure('submitted', closed) }

  if (input.imageBase64.startsWith('data:')) {
    return { ok: false, failure: failure('malformed', DATA_URL) }
  }
  if (input.imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    return { ok: false, failure: failure('malformed', TOO_LARGE) }
  }

  const imageSize = imageSizeOf(input.imageBase64)
  if (!imageSize) return { ok: false, failure: failure('malformed', UNREADABLE) }

  const preflight = bandForWidth(imageSize.width)
  if (preflight === 're-take') {
    return { ok: false, failure: failure('rejected', vettedCopy('upload_too_small')) }
  }

  const read = await readDocument(input.imageBase64, input.provider)
  // Above the re-take floor every read is text-only: Mistral returns markdown
  // with no boxes, so there is no fuller band to demote to or from.
  const band: QualityBand = preflight
  const documentId = randomUUID()

  // Recorded through the same commit path as the derived fields below, so it
  // is audited alongside them and on the record even when nothing in the
  // photo was legible to extract.
  const recorded = applyAction(input.applicationId, input.ownerToken, {
    type: 'RECORD_DOCUMENT',
    documentId,
    docType: input.docType,
    at: input.at,
  })
  if (!recorded.ok) return recorded

  const extractor = input.extractor ?? envExtractor()
  const candidates = parseCandidates(await extractor(input.docType, read.text))

  const filled: RequirementKey[] = []
  let state: ApplicationState = recorded.value

  for (const candidate of candidates) {
    const result = applyAction(input.applicationId, input.ownerToken, {
      type: 'SET_VALUE',
      fieldId: candidate.key,
      value: candidate.raw,
      source: 'ocr',
      at: input.at,
      documentId,
      confidence: scoreEvidence(candidate.evidence),
    })

    // One field the engine does not want must not sink the other eleven.
    if (!result.ok) continue
    state = result.value
    filled.push(candidate.key)
  }

  // The upload is an applicant act, so its response presents the group —
  // same as a turn would, deterministically. On failure (a refusal, or
  // presentPlan's own reducer call throwing) the upload still succeeds,
  // carrying the state it already has.
  const presented = presentPlan(input.applicationId, input.ownerToken, input.at)
  if (presented.ok) state = presented.value

  // Reading nothing is a normal outcome, not a failure — the fields get asked
  // for as they are today. The document itself is still on the record, via
  // the RECORD_DOCUMENT committed above.
  return { ok: true, value: { band, documentId, filled, state } }
}
