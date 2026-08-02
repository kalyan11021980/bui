import { describe, expect, it } from 'vitest'
import { bandForWidth, demoteForCardExtent } from '@/domain/ocr/quality'
import type { Detection } from '@/domain/ocr/grounding'

describe('bandForWidth', () => {
  it('crops at and above the localisation floor', () => {
    expect(bandForWidth(1012)).toBe('full')
    expect(bandForWidth(1000)).toBe('full')
  })

  it('reads without crops in the band where grounding fails but text survives', () => {
    // The gate measured 12/12 fields read and 3/12 boxes placed at 405px.
    expect(bandForWidth(999)).toBe('text-only')
    expect(bandForWidth(405)).toBe('text-only')
    expect(bandForWidth(400)).toBe('text-only')
  })

  it('asks for another photo below the recognition floor', () => {
    expect(bandForWidth(399)).toBe('re-take')
    expect(bandForWidth(202)).toBe('re-take')
    expect(bandForWidth(0)).toBe('re-take')
  })
})

describe('demoteForCardExtent', () => {
  const spanning = (x0: number, x1: number): Detection =>
    ({ text: 'X', box: [x0, 0, x1, 100] })

  it('keeps full when the card fills most of the frame', () => {
    const detections = [spanning(20, 980)]
    expect(demoteForCardExtent('full', detections, 2000)).toBe('full')
  })

  it('demotes a large photo of a small card', () => {
    // Card occupies 250/1000 of the frame: 2000px image, 500px of card.
    const detections = [spanning(400, 650)]
    expect(demoteForCardExtent('full', detections, 2000)).toBe('text-only')
  })

  it('never promotes', () => {
    const detections = [spanning(0, 1000)]
    expect(demoteForCardExtent('text-only', detections, 4000)).toBe('text-only')
  })

  it('demotes when nothing was detected at all', () => {
    expect(demoteForCardExtent('full', [], 2000)).toBe('text-only')
  })
})
