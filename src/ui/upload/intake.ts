import type { DocType } from '@/domain/field-id'
import { bandForWidth } from '@/domain/ocr/quality'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { prepareImage, type PreparedImage } from '@/ui/panel/prepare-image'

export const DOC_LABEL: Record<DocType, string> = {
  drivers_license: vettedCopy('doc_label_drivers_license'),
  state_id: vettedCopy('doc_label_state_id'),
  passport: vettedCopy('doc_label_passport'),
  dealer_license: vettedCopy('doc_label_dealer_license'),
  proof_of_residency: vettedCopy('doc_label_proof_of_residency'),
}

export const TOO_SMALL = vettedCopy('upload_too_small')
export const TEXT_ONLY = vettedCopy('upload_text_only')
export const UNOPENABLE = vettedCopy('upload_unopenable')

export type IntakeVerdict =
  | { kind: 'unopenable' }
  | { kind: 're-take' }
  | { kind: 'ok'; image: PreparedImage; notice: string | null }

/** One judgement for every surface a photo can enter through. */
export async function judgeFile(
  file: File,
  prepare: (f: File) => Promise<PreparedImage> = prepareImage,
): Promise<IntakeVerdict> {
  let image: PreparedImage
  try {
    image = await prepare(file)
  } catch {
    return { kind: 'unopenable' }
  }
  const band = bandForWidth(image.imageSize.width)
  if (band === 're-take') return { kind: 're-take' }
  return { kind: 'ok', image, notice: band === 'text-only' ? TEXT_ONLY : null }
}
