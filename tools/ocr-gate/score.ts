import {
  findValue,
  intersectionOverUnion,
  normalizeText,
  type Box,
  type Detection,
} from '@/domain/ocr/grounding'

/**
 * Scoring for the OCR acceptance gate: field-level exact match primary (one wrong
 * character fails the field), CER secondary, IoU >= 0.5 per ICDAR/COCO.
 */

export const IOU_THRESHOLD = 0.5

/** A list when the card splits the value across two lines ('ANGELINA' / 'GABRIELA'). */
export type ExpectedValue = string | readonly string[]

export type FieldScore = {
  readonly expected: ExpectedValue
  readonly found: boolean
  readonly detection: Detection | null
  readonly cer: number
  readonly iou: number | null
}

export function characterErrorRate(expected: string, actual: string): number {
  const a = normalizeText(expected)
  const b = normalizeText(actual)
  if (a === '') return b === '' ? 0 : 1

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return (previous[b.length] ?? a.length) / a.length
}

export type ScoreOptions = {
  /** Label printed beside the value, used to disambiguate repeats. */
  readonly label?: string
  /** Ground-truth box, when one is known. Omit to skip localisation. */
  readonly trueBox?: Box
}

export function scoreField(
  expected: ExpectedValue,
  fullText: string,
  detections: readonly Detection[],
  options: ScoreOptions = {},
): FieldScore {
  const parts = typeof expected === 'string' ? [expected] : [...expected]
  const haystack = normalizeText(fullText)
  const found = parts.every((part) => haystack.includes(normalizeText(part)))

  const primary = parts[0] ?? ''
  const detection = findValue(
    detections, primary, options.label ? { label: options.label } : {},
  )

  // Against the nearest detection: "how close was the closest reading".
  const cer = detection
    ? 0
    : detections.reduce(
        (best, d) => Math.min(best, characterErrorRate(primary, d.text)), 1,
      )

  return {
    expected,
    found,
    detection,
    cer: Number(cer.toFixed(3)),
    // A box around the wrong string is not a localisation result.
    iou: options.trueBox && detection
      ? Number(intersectionOverUnion(detection.box, options.trueBox).toFixed(3))
      : null,
  }
}

export type Summary = {
  readonly read: number
  readonly fields: number
  readonly localised: number
  readonly boxed: number
}

export function summarise(scores: readonly FieldScore[]): Summary {
  const boxed = scores.filter((s) => s.iou !== null)
  return {
    read: scores.filter((s) => s.found).length,
    fields: scores.length,
    localised: boxed.filter((s) => (s.iou ?? 0) >= IOU_THRESHOLD).length,
    boxed: boxed.length,
  }
}
