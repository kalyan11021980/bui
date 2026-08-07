/**
 * Recognition and localisation fail at different resolutions. Measured
 * 2026-08-02: 12/12 fields read at 405px, 3/12 boxes within IoU 0.5. Under the
 * Mistral-markdown pipeline there are no boxes, so the only question a width
 * answers is whether the photo is legible at all.
 */
export const READ_FLOOR_PX = 400

export type QualityBand = 'text-only' | 're-take'

export function bandForWidth(pixelWidth: number): QualityBand {
  if (pixelWidth >= READ_FLOOR_PX) return 'text-only'
  return 're-take'
}