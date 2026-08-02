import { describe, expect, it } from 'vitest'
import { isPlausibleBox, toPixels } from '@/domain/ocr/geometry'
import type { Box } from '@/domain/ocr/grounding'

describe('toPixels — stretch', () => {
  it('maps a full-extent box to the whole image', () => {
    const result = toPixels([0, 0, 1000, 1000], { width: 1600, height: 1000 }, 'stretch')
    expect(result).toEqual({ x: 0, y: 0, width: 1600, height: 1000 })
  })

  it('maps a quarter box proportionally on each axis', () => {
    const result = toPixels([250, 500, 500, 750], { width: 800, height: 400 }, 'stretch')
    expect(result).toEqual({ x: 200, y: 200, width: 200, height: 100 })
  })

  it('clamps an inverted box to non-negative width and height', () => {
    // x0 > x1 and y0 > y1: malformed model output, not filtered upstream.
    const result = toPixels([600, 700, 200, 300], { width: 1600, height: 1000 }, 'stretch')
    expect(result.width).toBeGreaterThanOrEqual(0)
    expect(result.height).toBeGreaterThanOrEqual(0)
  })
})

describe('toPixels — pad', () => {
  it('removes the letterbox band on the short axis', () => {
    // 1600x800 padded to a 1600x1600 square: 400px band top and bottom.
    // Normalised y 250..750 is the padded square's middle half, which is
    // exactly the image.
    const result = toPixels([0, 250, 1000, 750], { width: 1600, height: 800 }, 'pad')
    expect(result).toEqual({ x: 0, y: 0, width: 1600, height: 800 })
  })

  it('leaves the long axis untouched', () => {
    const result = toPixels([0, 250, 500, 750], { width: 1600, height: 800 }, 'pad')
    expect(result.x).toBe(0)
    expect(result.width).toBe(800)
  })

  it('clamps a box that lands inside the padding', () => {
    const result = toPixels([0, 0, 1000, 100], { width: 1600, height: 800 }, 'pad')
    expect(result.y).toBe(0)
    expect(result.height).toBe(0)
  })

  it('clamps an inverted box to non-negative width and height', () => {
    // x0 > x1 and y0 > y1: malformed model output, not filtered upstream.
    const result = toPixels([600, 700, 200, 300], { width: 1600, height: 800 }, 'pad')
    expect(result.width).toBeGreaterThanOrEqual(0)
    expect(result.height).toBeGreaterThanOrEqual(0)
  })
})

describe('round-trip', () => {
  const sizes: Array<{ width: number; height: number }> = [
    { width: 1600, height: 1000 }, { width: 640, height: 480 },
    { width: 1000, height: 1000 }, { width: 480, height: 1600 },
    { width: 3024, height: 4032 },
  ]

  it('never leaves the image, for any size or fit', () => {
    const boxes: Box[] = [
      [0, 0, 1000, 1000], [0, 0, 1, 1], [999, 999, 1000, 1000],
      [250, 250, 750, 750], [100, 900, 200, 950],
    ]

    for (const size of sizes) {
      for (const fit of ['stretch', 'pad'] as const) {
        for (const box of boxes) {
          const r = toPixels(box, size, fit)
          expect(r.x).toBeGreaterThanOrEqual(0)
          expect(r.y).toBeGreaterThanOrEqual(0)
          expect(r.x + r.width).toBeLessThanOrEqual(size.width)
          expect(r.y + r.height).toBeLessThanOrEqual(size.height)
          expect(r.width).toBeGreaterThanOrEqual(0)
          expect(r.height).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('isPlausibleBox', () => {
  it('rejects an inverted box', () => {
    expect(isPlausibleBox([500, 500, 100, 600])).toBe(false)
  })

  it('rejects a box covering nearly the whole card', () => {
    expect(isPlausibleBox([0, 0, 1000, 1000])).toBe(false)
  })

  it('accepts an ordinary field box', () => {
    expect(isPlausibleBox([120, 300, 480, 340])).toBe(true)
  })
})
