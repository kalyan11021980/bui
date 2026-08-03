import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractAamva } from '@/domain/ocr/extract/aamva'
import { extractFor, parseCandidates } from '@/domain/ocr/extract'
import type { Detection } from '@/domain/ocr/grounding'

/**
 * Recall against the recorded specimens, graded on values transcribed by eye
 * from the images (`specimens/ground_truth.json`) — never on the recorded OCR
 * text. Grading an extractor against OCR output measures parsing, not reading,
 * and would score a misread card as a success.
 */

type Fixture = {
  docType: 'drivers_license' | 'state_id'
  image: string
  detections: Detection[]
  text: string
}

type Truth = { image: string; fields: Record<string, string | string[]> }

const AAMVA = new Set(['drivers_license', 'state_id'])

const cards: Fixture[] = readdirSync('sample/licenses/fixtures')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`sample/licenses/fixtures/${f}`, 'utf8')) as Fixture)
  .filter((f) => AAMVA.has(f.docType))

const truth: Truth[] = JSON.parse(
  readFileSync('sample/licenses/specimens/ground_truth.json', 'utf8'),
).specimens

const slug = (path: string): string => path.split('/').pop() ?? path

/** Grounded output has no spaces and OCR keeps or drops punctuation at whim. */
const flat = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

const iso = (printed: string): string => {
  const [month, day, year] = printed.split(/[/-]/)
  return `${year}-${month}-${day}`
}

function expected(card: Fixture, field: string): string | null {
  const fields = truth.find((t) => t.image === slug(card.image))?.fields
  const value = fields?.[field]
  if (value === undefined) return null
  if (field === 'dob' || field === 'dl_expiry') return iso(String(value))
  // A card that prints given names on one line answers first_name with the
  // first of them; a street printed over two lines answers with both.
  if (Array.isArray(value)) return field === 'first_name' ? String(value[0]) : value.join('')
  return String(value)
}

/**
 * Exact, once spacing and punctuation are off. A prefix rule here would pass
 * JANET for JANE, and pass any amount of trailing over-capture.
 */
const matches = (read: string, want: string): boolean => flat(read) === flat(want)

function readCard(card: Fixture): Map<string, string> {
  const out = parseCandidates(extractFor(card.docType, card.detections, card.text))
  return new Map(out.map((c) => [c.key, c.raw]))
}

/**
 * What each specimen currently yields, and which of those values do not match
 * the card. Locked rather than counted, so an anchor that stops firing fails
 * here instead of quietly lowering a number nobody reads.
 */
const COMMON = [
  'dob', 'dl_expiry', 'last_name', 'first_name',
  'addr_line1', 'addr_city', 'addr_state', 'addr_zip',
]
/** Each document type owes its own number field, under its own name. */
const ALL = ['dl_number', ...COMMON]
const ID_ALL = ['id_number', ...COMMON]

const EXPECTED: Record<string, { reads: readonly string[]; wrong: Record<string, string> }> = {
  'wa_enhanced.png': { reads: ALL, wrong: {} },
  'dc_2018.png': { reads: ALL, wrong: {} },
  'or_2020.png': { reads: ALL, wrong: {} },
  'va_2023.png': {
    reads: ALL,
    wrong: {
      addr_line1: 'OCR read JOHN TYLER HWY as J0HN, a zero for the letter',
      first_name: 'OCR returned RICHARD BENJAMIN with no space, so the middle name cannot be split off',
    },
  },
  'ma_2016.png': {
    reads: ['dl_number', 'dob', 'dl_expiry', 'addr_line1', 'addr_city', 'addr_state', 'addr_zip'],
    // OCR dropped this card's 1, 2 and 8 codes; the card does print them.
    wrong: {},
  },
  'ca_2019.png': {
    reads: ['dl_number', 'dob', 'dl_expiry', 'last_name', 'first_name'],
    wrong: { dl_number: 'OCR read the leading I as a 1' },
  },
  // Pre-AAMVA, 1977: no numbered codes to anchor to at all.
  'md_1977.png': { reads: [], wrong: {} },
  'ca_id_2010.png': {
    reads: ID_ALL,
    wrong: { id_number: 'OCR read the leading I as a 1, as on the CA licence' },
  },
  'va_id_2023.png': {
    reads: ID_ALL,
    wrong: { first_name: 'OCR returned JAMES ALAN with no space, so the middle name cannot be split off' },
  },
}

/** Recall, stated as a number so a change to it has to be argued for. */
const TOTALS = { read: 66, correct: 61, fields: 81 }

describe('AAMVA recall against recorded specimens', () => {
  it('has the corpus it thinks it has', () => {
    // Guards every loop below: a filter that matched nothing would pass them all.
    expect(cards.map((c) => slug(c.image)).sort()).toEqual(Object.keys(EXPECTED).sort())
    expect(cards.filter((c) => c.docType === 'drivers_license')).toHaveLength(7)
    expect(cards.filter((c) => c.docType === 'state_id')).toHaveLength(2)
    for (const card of cards) {
      expect(truth.find((t) => t.image === slug(card.image)), slug(card.image)).toBeDefined()
    }
  })

  it('reads a licence number from every licence printing an AAMVA code', () => {
    const modern = cards.filter(
      (c) => c.docType === 'drivers_license' && slug(c.image) !== 'md_1977.png',
    )
    expect(modern).toHaveLength(6)
    for (const card of modern) {
      expect([...readCard(card).keys()], slug(card.image)).toContain('dl_number')
    }
  })

  it('never derives dl_number from a state ID, whatever the card prints', () => {
    for (const card of cards.filter((c) => c.docType === 'state_id')) {
      // The strategy reads the number; the catalog is what refuses it.
      expect(extractAamva(card.detections, '').map((c) => c.key)).toContain('dl_number')
      expect([...readCard(card).keys()], slug(card.image)).not.toContain('dl_number')
    }
  })

  for (const card of cards) {
    const name = slug(card.image)
    const lock = EXPECTED[name]

    it(`reads the fields it can off ${name}`, () => {
      expect(lock).toBeDefined()
      const read = readCard(card)
      expect([...read.keys()].sort()).toEqual([...(lock?.reads ?? [])].sort())

      for (const [field, value] of read) {
        const want = expected(card, field)
        expect(want, `${name}: no ground truth for ${field}`).not.toBeNull()
        const reason = lock?.wrong[field]
        // A field listed as wrong that starts matching is good news the table
        // has to be told about.
        expect(matches(value, want ?? ''), `${name} ${field}=${value} want ${want}${reason ? ` (${reason})` : ''}`)
          .toBe(reason === undefined)
      }
    })
  }

  it('reads 66 of 81 fields, 61 of them right', () => {
    let read = 0
    let correct = 0
    let fields = 0

    for (const card of cards) {
      fields += card.docType === 'drivers_license' ? ALL.length : ID_ALL.length
      for (const [field, value] of readCard(card)) {
        read += 1
        if (matches(value, expected(card, field) ?? '')) correct += 1
      }
    }

    expect({ read, correct, fields }).toEqual(TOTALS)
  })

  it('puts every value it reads in a plausible box', () => {
    const seen = cards.flatMap(
      (card) => parseCandidates(extractFor(card.docType, card.detections, card.text)),
    )
    // Guards the loop: nothing to check would otherwise pass.
    expect(seen).toHaveLength(TOTALS.read)
    for (const c of seen) {
      expect(c.box, c.key).toBeDefined()
      expect(c.evidence.boxPlausible, c.key).toBe(true)
      // A card has no checksum and we make one pass: not failed, inapplicable.
      expect(c.evidence.checksumValid, c.key).toBeNull()
      expect(c.evidence.crossPassAgreed, c.key).toBeNull()
    }
  })
})
