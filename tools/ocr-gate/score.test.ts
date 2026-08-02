import { describe, it, expect } from 'vitest'
import { parseGrounding } from '@/domain/ocr/grounding'
import {
  characterErrorRate,
  scoreField,
  summarise,
  IOU_THRESHOLD,
} from './score'

/**
 * Every case here is a scoring bug that actually fired during the first gate
 * run and reported a correct read as a failure. They are regression tests for
 * the harness, not for the model.
 */

const WA = parseGrounding([
  '<|ref|>4dLIC#WDLJK00580GF<|/ref|><|det|>[[339, 241, 694, 290]]<|/det|>',
  '<|ref|>1SAMPLE<|/ref|><|det|>[[339, 293, 484, 341]]<|/det|>',
  '<|ref|>2JANE<|/ref|><|det|>[[338, 343, 435, 386]]<|/det|>',
  '<|ref|>5DDWDLJK00580GF<|/ref|><|det|>[[341, 840, 604, 876]]<|/det|>',
].join('\n'))

const DC = parseGrounding([
  '<|ref|>ANGELINA<|/ref|><|det|>[[314, 409, 431, 441]]<|/det|>',
  '<|ref|>GABRIELA<|/ref|><|det|>[[314, 443, 434, 475]]<|/det|>',
].join('\n'))

const raw = (dets: typeof WA) =>
  dets.map((d) => `<|ref|>${d.text}<|/ref|>`).join('\n')

describe('characterErrorRate', () => {
  it('is 0 for an identical reading', () => {
    expect(characterErrorRate('I1234568', 'I1234568')).toBe(0)
  })

  it('scores the real CA failure — a capital I read as a digit 1', () => {
    expect(characterErrorRate('I1234568', '11234568')).toBeCloseTo(1 / 8, 6)
  })

  it('ignores the spacing the model strips out anyway', () => {
    expect(characterErrorRate('JAMIE ALEX', 'JAMIEALEX')).toBe(0)
  })
})

describe('scoreField', () => {
  it('counts a value merged into its label as read', () => {
    // Cards merge label into value constantly. Demanding an exact detection
    // scored a correct read as a miss on the first run.
    const score = scoreField('WDLJK00580GF', raw(WA), WA)
    expect(score.found).toBe(true)
    expect(score.cer).toBe(0)
  })

  it('counts a value split across two card lines as read', () => {
    // 'ANGELINA' / 'GABRIELA' are separate detections. A concatenated
    // ground-truth string can never match, and scored 0 on the first run.
    expect(scoreField(['ANGELINA', 'GABRIELA'], raw(DC), DC).found).toBe(true)
  })

  it('does not count a partly-present multi-line value as read', () => {
    const partial = DC.slice(0, 1)
    expect(scoreField(['ANGELINA', 'GABRIELA'], raw(partial), partial).found)
      .toBe(false)
  })

  it('localises against the label rather than the tightest match', () => {
    // The WA licence number is printed twice. Without the label the tightest
    // detection is the bottom `5 DD` line, which scores IoU 0 against the
    // top field and looks like a localisation failure.
    const truth = [428, 244, 699, 288] as const

    const unanchored = scoreField('WDLJK00580GF', raw(WA), WA, { trueBox: truth })
    expect(unanchored.iou).toBe(0)

    const anchored = scoreField('WDLJK00580GF', raw(WA), WA, {
      label: '4d LIC#', trueBox: truth,
    })
    expect(anchored.iou).toBeGreaterThan(IOU_THRESHOLD)
  })

  it('reports no IoU rather than 0 when no ground-truth box is given', () => {
    // 0 would read as "mislocalised", which is a different claim from
    // "not measured".
    expect(scoreField('WDLJK00580GF', raw(WA), WA).iou).toBeNull()
  })

  it('gives an unread value a CER against the nearest reading', () => {
    const score = scoreField('NOTONTHECARD', raw(WA), WA)
    expect(score.found).toBe(false)
    expect(score.detection).toBeNull()
    expect(score.cer).toBeGreaterThan(0)
    expect(score.cer).toBeLessThanOrEqual(1)
  })
})

describe('summarise', () => {
  it('counts localisation only over fields that had a box to score', () => {
    const scores = [
      scoreField('WDLJK00580GF', raw(WA), WA, {
        label: '4d LIC#', trueBox: [428, 244, 699, 288],
      }),
      scoreField('JANE', raw(WA), WA),
      scoreField('NOTONTHECARD', raw(WA), WA),
    ]
    expect(summarise(scores)).toEqual({
      read: 2, fields: 3, localised: 1, boxed: 1,
    })
  })
})
