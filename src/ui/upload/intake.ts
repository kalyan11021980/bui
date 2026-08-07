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

// Module-locals: no importer outside intake.ts needs the raw notice text or
// the standalone judgement — every surface goes through intakeFile.
const TOO_SMALL = vettedCopy('upload_too_small')
const UNOPENABLE = vettedCopy('upload_unopenable')

export type IntakeVerdict =
  | { kind: 'unopenable' }
  | { kind: 're-take' }
  | { kind: 'ok'; image: PreparedImage; notice: string | null }

/** One judgement for every surface a photo can enter through. */
async function judgeFile(
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
  // Below the re-take floor a photo is too small to read; above it, it reads
  // fine. Mistral OCR gives no bounding boxes, so there is no crop to warn
  // about and no notice to show before the read comes back.
  return { kind: 'ok', image, notice: null }
}

/** The last mile every upload surface repeats: judge, notice, deliver. */
export async function intakeFile(
  file: File,
  setNotice: (notice: string | null) => void,
  deliver: (image: PreparedImage) => void,
  prepare?: (f: File) => Promise<PreparedImage>,
): Promise<void> {
  const verdict = await judgeFile(file, prepare)
  if (verdict.kind === 'unopenable') { setNotice(UNOPENABLE); return }
  if (verdict.kind === 're-take') { setNotice(TOO_SMALL); return }
  setNotice(verdict.notice)
  deliver(verdict.image)
}
