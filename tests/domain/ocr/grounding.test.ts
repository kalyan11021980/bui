import { describe, it, expect } from 'vitest'
import {
  parseGrounding,
  intersectionOverUnion,
  normalizeText,
  findValue,
  type Detection,
} from '@/domain/ocr/grounding'

const det = (text: string, box: [number, number, number, number]): Detection =>
  ({ text, box })

describe('parseGrounding', () => {
  it('parses one detection', () => {
    expect(parseGrounding('<|ref|>JONES<|/ref|><|det|>[[311, 321, 393, 361]]<|/det|>'))
      .toEqual([det('JONES', [311, 321, 393, 361])])
  })

  it('parses a run of detections separated by newlines', () => {
    const raw = [
      '<|ref|>A9999999<|/ref|><|det|>[[312, 250, 421, 284]]<|/det|>',
      '<|ref|>02/21/2018<|/ref|><|det|>[[538, 250, 655, 284]]<|/det|>',
    ].join('\n')
    expect(parseGrounding(raw).map((d) => d.text))
      .toEqual(['A9999999', '02/21/2018'])
  })

  it('splits a detection carrying more than one box into one per box', () => {
    // A ref that appears twice on the page comes back with both regions.
    const raw = '<|ref|>NONE<|/ref|><|det|>[[10, 20, 30, 40], [50, 60, 70, 80]]<|/det|>'
    expect(parseGrounding(raw)).toEqual([
      det('NONE', [10, 20, 30, 40]),
      det('NONE', [50, 60, 70, 80]),
    ])
  })

  it('keeps the surrounding text out of the detection', () => {
    const raw = 'preamble <|ref|>X<|/ref|><|det|>[[1, 2, 3, 4]]<|/det|> trailing'
    expect(parseGrounding(raw)).toEqual([det('X', [1, 2, 3, 4])])
  })

  it('drops a malformed detection without losing the rest of the page', () => {
    // Model output is untrusted input. One stray token must not cost us
    // every field on the card.
    const raw = [
      '<|ref|>GOOD<|/ref|><|det|>[[1, 2, 3, 4]]<|/det|>',
      '<|ref|>BAD<|/ref|><|det|>[[9, 9]]<|/det|>',
      '<|ref|>ALSOGOOD<|/ref|><|det|>[[5, 6, 7, 8]]<|/det|>',
    ].join('\n')
    expect(parseGrounding(raw).map((d) => d.text)).toEqual(['GOOD', 'ALSOGOOD'])
  })

  it('returns nothing for output with no grounding tags at all', () => {
    expect(parseGrounding('# GEORGIA\n**049-12-3456**')).toEqual([])
  })

  it('tolerates a truncated trailing tag', () => {
    // max_tokens cuts the response mid-tag routinely.
    const raw = '<|ref|>GOOD<|/ref|><|det|>[[1, 2, 3, 4]]<|/det|>\n<|ref|>'
    expect(parseGrounding(raw)).toEqual([det('GOOD', [1, 2, 3, 4])])
  })
})

describe('normalizeText', () => {
  it('strips whitespace and upper-cases', () => {
    // Grounded mode returns 'JAMIEALEX' for 'JAMIE ALEX', so whitespace
    // cannot take part in any comparison.
    expect(normalizeText('Jamie Alex')).toBe('JAMIEALEX')
  })
})

describe('intersectionOverUnion', () => {
  it('is 1 for identical boxes', () => {
    expect(intersectionOverUnion([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1)
  })

  it('is 0 for disjoint boxes', () => {
    expect(intersectionOverUnion([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0)
  })

  it('is 0 for boxes that only touch at an edge', () => {
    expect(intersectionOverUnion([0, 0, 10, 10], [10, 0, 20, 10])).toBe(0)
  })

  it('computes a partial overlap', () => {
    // Intersection 5x10=50; union 100+100-50=150.
    expect(intersectionOverUnion([0, 0, 10, 10], [5, 0, 15, 10]))
      .toBeCloseTo(50 / 150, 6)
  })

  it('is 0 rather than NaN for a degenerate box', () => {
    expect(intersectionOverUnion([5, 5, 5, 5], [0, 0, 10, 10])).toBe(0)
  })
})

describe('findValue', () => {
  const dets = [
    det('4dLIC#WDLJK00580GF', [339, 241, 694, 290]),
    det('1SAMPLE', [339, 293, 484, 341]),
    det('5DDWDLJK00580GF', [341, 840, 604, 876]),
  ]

  it('finds a value merged into a label', () => {
    // Cards merge label into value constantly. Matching only exact
    // detections would score a correct read as a miss.
    expect(findValue(dets, 'WDLJK00580GF')?.text).toBe('5DDWDLJK00580GF')
  })

  it('ignores spacing and case in both the needle and the haystack', () => {
    expect(findValue(dets, 'wdljk 00580 gf')?.text).toBe('5DDWDLJK00580GF')
  })

  it('returns null when the value is absent', () => {
    expect(findValue(dets, 'NOTONTHECARD')).toBeNull()
  })

  it('prefers the detection anchored to the requested label', () => {
    // THE FINDING THIS EXISTS FOR: the WA licence number is printed twice,
    // at `4d LIC#` and again at `5 DD`. Selecting by value alone crops the
    // wrong region of the card. The label disambiguates; nothing else can.
    expect(findValue(dets, 'WDLJK00580GF', { label: '4dLIC#' })?.box)
      .toEqual([339, 241, 694, 290])
  })

  it('falls back to the tightest match when the label is absent from the page', () => {
    expect(findValue(dets, 'WDLJK00580GF', { label: '9zNOSUCHLABEL' })?.text)
      .toBe('5DDWDLJK00580GF')
  })

  it('matches a label case- and space-insensitively too', () => {
    expect(findValue(dets, 'WDLJK00580GF', { label: '4d LIC #' })?.box)
      .toEqual([339, 241, 694, 290])
  })
})
