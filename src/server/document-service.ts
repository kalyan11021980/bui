// Strategies register themselves on import. Without these the pipeline has
// nothing to dispatch to and silently reads nothing.
import '@/domain/ocr/extract/aamva'
import '@/domain/ocr/extract/labelled'
import '@/domain/ocr/extract/mrz'

import { randomUUID } from 'node:crypto'
import { scoreEvidence, withCrossPass } from '@/domain/ocr/confidence'
import { extractFor, parseCandidates } from '@/domain/ocr/extract'
import { FIT_MODEL, isPlausibleBox, toPixels, type ImageSize } from '@/domain/ocr/geometry'
import { bandForWidth, demoteForCardExtent, type QualityBand } from '@/domain/ocr/quality'
import { applyAction, getApplication, type Result } from './application-service'
import { failure } from './http'
import { imageSizeOf } from './image-size'
import { readDocument, type OcrProvider } from './ocr/service'
import type { ApplicationState } from '@/domain/application/state'
import type { Box } from '@/domain/ocr/grounding'
import type { DocType } from '@/domain/field-id'
import type { RequirementKey } from '@/domain/requirements/key'

export type IngestInput = {
  readonly applicationId: string
  readonly docType: DocType
  /** Bare base64 payload, no `data:` prefix. Held for the call and discarded. */
  readonly imageBase64: string
  readonly at: string
  readonly provider?: OcrProvider
}

export type IngestOutcome = {
  readonly band: QualityBand
  readonly filled: readonly RequirementKey[]
  readonly state: ApplicationState
}

const TOO_SMALL =
  'That photo is too small to read. Take another with the document filling the frame.'
const UNREADABLE = 'Upload a PNG or JPEG photo of the document.'

export async function ingestDocument(
  input: IngestInput,
): Promise<Result<IngestOutcome>> {
  // Before the read: an application that does not exist cannot be told
  // anything, and a two-pass OCR call on its behalf is spent for nothing.
  const existing = getApplication(input.applicationId)
  if (!existing.ok) return existing

  const imageSize = imageSizeOf(input.imageBase64)
  if (!imageSize) return { ok: false, failure: failure('malformed', UNREADABLE) }

  const preflight = bandForWidth(imageSize.width)
  if (preflight === 're-take') {
    return { ok: false, failure: failure('rejected', TOO_SMALL) }
  }

  const read = await readDocument(input.imageBase64, input.provider)
  const band = demoteForCardExtent(preflight, read.detections, imageSize.width)
  const documentId = randomUUID()

  const candidates = withCrossPass(
    parseCandidates(extractFor(input.docType, read.detections, read.text)),
    read.plainText,
  )

  const filled: RequirementKey[] = []
  let state: ApplicationState | null = null

  for (const candidate of candidates) {
    const box = provenanceBox(band, candidate.box, imageSize)

    const result = applyAction(input.applicationId, {
      type: 'SET_VALUE',
      fieldId: candidate.key,
      value: candidate.raw,
      source: 'ocr',
      at: input.at,
      documentId,
      confidence: scoreEvidence(candidate.evidence),
      ...(box && { box }),
    })

    // One field the engine does not want must not sink the other eleven.
    if (!result.ok) continue
    state = result.value
    filled.push(candidate.key)
  }

  // Reading nothing is a normal outcome, not a failure — the fields get asked
  // for as they are today. Fetch rather than mutate: a no-op action would put
  // an event in the audit log saying something happened.
  if (state === null) {
    const current = getApplication(input.applicationId)
    if (!current.ok) return current
    state = current.value
  }

  return { ok: true, value: { band, filled, state } }
}

/**
 * Below the crop floor a box is recorded nowhere: a crop drawn from an
 * untrustworthy box asserts a value came from a region it did not, which is
 * worse than showing no crop at all. Same reasoning for a box the size of the
 * whole card, which is a detection failure wearing a box.
 */
function provenanceBox(
  band: QualityBand,
  box: Box | undefined,
  imageSize: ImageSize,
): readonly [number, number, number, number] | null {
  if (band !== 'full' || !box || !isPlausibleBox(box)) return null
  const pixels = toPixels(box, imageSize, FIT_MODEL)
  return [
    pixels.x, pixels.y,
    pixels.x + pixels.width, pixels.y + pixels.height,
  ] as const
}
