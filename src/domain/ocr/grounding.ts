/**
 * Parsing for DeepSeek-OCR grounded output:
 * `<|ref|>TEXT<|/ref|><|det|>[[x0,y0,x1,y1]]<|/det|>`, coordinates 0-1000
 * against the model's own square input. The HTTP call lives in `@/server/ocr`.
 */

/** `[x0, y0, x1, y1]`, origin top-left — 0-1000 from the model, pixels once mapped. */
export type Box = readonly [number, number, number, number]

export type Detection = {
  readonly text: string
  readonly box: Box
}

const DETECTION =
  /<\|ref\|>([\s\S]*?)<\|\/ref\|>\s*<\|det\|>\[([\s\S]*?)\]<\|\/det\|>/g

const COORD_GROUP = /\[([^\]]*)\]/g

/** Grounded output strips spaces — 'JAMIE ALEX' comes back as 'JAMIEALEX'. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

/**
 * One Detection per box: the same string printed twice on a card is two
 * places on that card.
 *
 * Malformed detections are skipped rather than thrown on — responses cut by
 * `max_tokens` end mid-tag routinely, and one stray token must not cost us
 * every field.
 */
export function parseGrounding(raw: string): Detection[] {
  const out: Detection[] = []

  for (const [, text, coords] of raw.matchAll(DETECTION)) {
    if (text === undefined || coords === undefined) continue

    for (const [, group] of coords.matchAll(COORD_GROUP)) {
      const nums = group?.match(/-?\d+/g)?.map(Number) ?? []
      if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) continue
      const [x0, y0, x1, y1] = nums as [number, number, number, number]
      out.push({ text: text.trim(), box: [x0, y0, x1, y1] })
    }
  }

  return out
}

function area(box: Box): number {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1])
}

export function intersectionOverUnion(a: Box, b: Box): number {
  const ix0 = Math.max(a[0], b[0])
  const iy0 = Math.max(a[1], b[1])
  const ix1 = Math.min(a[2], b[2])
  const iy1 = Math.min(a[3], b[3])
  if (ix1 <= ix0 || iy1 <= iy0) return 0

  const intersection = (ix1 - ix0) * (iy1 - iy0)
  const union = area(a) + area(b) - intersection
  return union > 0 ? intersection / union : 0
}

export type FindOptions = {
  /** Label printed beside the value, e.g. `4d LIC#`. */
  readonly label?: string
}

/**
 * The detection containing `value`, preferring the one anchored to `label`.
 *
 * Containment, not equality: cards merge label into value, so a licence number
 * arrives as `4dLIC#WDLJK00580GF`.
 *
 * Pass a label whenever you have one. A licence number is often printed twice
 * on a card (Washington: `4d LIC#` and `5 DD`) and both come back grounded —
 * value alone picks whichever is tightest, which is the wrong one about half
 * the time.
 */
export function findValue(
  detections: readonly Detection[],
  value: string,
  options: FindOptions = {},
): Detection | null {
  const want = normalizeText(value)
  if (want === '') return null

  const containing = detections.filter((d) => normalizeText(d.text).includes(want))
  if (containing.length === 0) return null

  const label = options.label ? normalizeText(options.label) : ''
  const anchored = label
    ? containing.filter((d) => normalizeText(d.text).includes(label))
    : []

  // A label that appears nowhere is a bad guess, not a missing value.
  const pool = anchored.length > 0 ? anchored : containing

  return pool.reduce((best, d) =>
    normalizeText(d.text).length < normalizeText(best.text).length ? d : best,
  )
}
