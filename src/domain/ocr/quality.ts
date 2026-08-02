import type { Detection } from './grounding'

/**
 * Recognition and localisation fail at different resolutions. Measured
 * 2026-08-02: 12/12 fields read at 405px, 3/12 boxes within IoU 0.5.
 */
export const CROP_FLOOR_PX = 1000
export const READ_FLOOR_PX = 400

export type QualityBand = 'full' | 'text-only' | 're-take'

export function bandForWidth(pixelWidth: number): QualityBand {
  if (pixelWidth >= CROP_FLOOR_PX) return 'full'
  if (pixelWidth >= READ_FLOOR_PX) return 'text-only'
  return 're-take'
}

/**
 * Image width stands in for card width before the call. Afterwards the spread
 * of detections says how much of the frame the card actually filled — a big
 * photo of a distant card reads fine and crops wrong.
 */
export function demoteForCardExtent(
  band: QualityBand,
  detections: readonly Detection[],
  imageWidth: number,
): QualityBand {
  if (band !== 'full') return band
  if (detections.length === 0) return 'text-only'

  const left = Math.min(...detections.map((d) => d.box[0]))
  const right = Math.max(...detections.map((d) => d.box[2]))
  const cardWidth = ((right - left) / 1000) * imageWidth

  return cardWidth >= CROP_FLOOR_PX ? 'full' : 'text-only'
}
