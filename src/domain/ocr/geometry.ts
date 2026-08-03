import type { Box } from './grounding'

export type ImageSize = { readonly width: number; readonly height: number }
export type PixelBox = {
  readonly x: number; readonly y: number
  readonly width: number; readonly height: number
}

/**
 * Whether the server scaled the image to a square or padded it to one. Wrong
 * choice puts every crop off by a letterbox band. Settled by calibration, not
 * assumption.
 */
export type FitModel = 'stretch' | 'pad'

/**
 * Measured 2026-08-02 against markers at known pixel positions; see the
 * fit-model decision record. Both models agree on a square, so only the
 * non-square renders decide it.
 */
export const FIT_MODEL: FitModel = 'stretch'

const SCALE = 1000

export function toPixels(box: Box, size: ImageSize, fit: FitModel): PixelBox {
  const [x0, y0, x1, y1] = box
  if (fit === 'stretch') {
    return clamp(
      (x0 / SCALE) * size.width, (y0 / SCALE) * size.height,
      (x1 / SCALE) * size.width, (y1 / SCALE) * size.height,
      size,
    )
  }

  // Padded to a square of the longer side, image centred.
  const side = Math.max(size.width, size.height)
  const offsetX = (side - size.width) / 2
  const offsetY = (side - size.height) / 2

  return clamp(
    (x0 / SCALE) * side - offsetX, (y0 / SCALE) * side - offsetY,
    (x1 / SCALE) * side - offsetX, (y1 / SCALE) * side - offsetY,
    size,
  )
}

function clamp(
  x0: number, y0: number, x1: number, y1: number, size: ImageSize,
): PixelBox {
  const left = Math.min(Math.max(x0, 0), size.width)
  const top = Math.min(Math.max(y0, 0), size.height)
  const right = Math.min(Math.max(x1, 0), size.width)
  const bottom = Math.min(Math.max(y1, 0), size.height)

  return {
    x: left, y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/** A box the size of the whole card is a detection failure wearing a box. */
export function isPlausibleBox(box: Box): boolean {
  const [x0, y0, x1, y1] = box
  if (x1 <= x0 || y1 <= y0) return false
  const coverage = ((x1 - x0) * (y1 - y0)) / (SCALE * SCALE)
  return coverage < 0.6
}
