import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractAamva, respaceAddresses } from '@/domain/ocr/extract/aamva'
import { extractFor, parseCandidates } from '@/domain/ocr/extract'
import { QUIET_THRESHOLD, scoreEvidence, withCrossPass } from '@/domain/ocr/confidence'
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
  plainText: string
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

/** The one named specimen a test wants, not the whole corpus array. */
function fixture(name: string): Fixture {
  const found = cards.find((c) => slug(c.image) === `${name}.png`)
  if (!found) throw new Error(`no fixture named ${name}`)
  return found
}

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

/** What each document type owes, so a card is graded against its own fields. */
const GRADED: Record<Fixture['docType'], readonly string[]> = {
  drivers_license: ALL,
  state_id: ID_ALL,
}

/**
 * Recall, stated as a number so a change to it has to be argued for, and split
 * by document type so a change is attributable. One lumped total hid which
 * half moved — and the two field lists are the same length, so a ternary over
 * them could not tell its own branches apart.
 */
const TOTALS: Record<Fixture['docType'], { read: number; correct: number; fields: number }> = {
  drivers_license: { read: 48, correct: 45, fields: 63 },
  state_id: { read: 18, correct: 16, fields: 18 },
}

const summed = (of: 'read' | 'correct' | 'fields'): number =>
  TOTALS.drivers_license[of] + TOTALS.state_id[of]

/** Counts one document type, or the whole corpus when given none. */
function tally(docType?: Fixture['docType']) {
  let read = 0
  let correct = 0
  let fields = 0

  for (const card of cards.filter((c) => docType === undefined || c.docType === docType)) {
    fields += GRADED[card.docType].length
    for (const [field, value] of readCard(card)) {
      read += 1
      if (matches(value, expected(card, field) ?? '')) correct += 1
    }
  }
  return { read, correct, fields }
}

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

  it('grades each document type against its own field list', () => {
    // The two lists are the same length, so a swap would not move any total.
    // What separates them is which number field they name.
    expect(GRADED.drivers_license).toContain('dl_number')
    expect(GRADED.drivers_license).not.toContain('id_number')
    expect(GRADED.state_id).toContain('id_number')
    expect(GRADED.state_id).not.toContain('dl_number')
  })

  it('reads 48 of 63 fields off the licences, 45 of them right', () => {
    expect(tally('drivers_license')).toEqual(TOTALS.drivers_license)
  })

  it('reads every one of the 18 fields off the ID cards, 16 of them right', () => {
    // Split out so a change is attributable: one lumped number could move
    // because ID cards regressed and licences improved by the same amount.
    expect(tally('state_id')).toEqual(TOTALS.state_id)
  })

  it('reads 66 of 81 fields across the corpus, 61 of them right', () => {
    const all = cards.map((c) => c.docType)
    // Guards the two above: a docType present in neither tally is ungraded.
    expect(new Set(all)).toEqual(new Set(Object.keys(TOTALS)))
    expect(tally()).toEqual({
      read: summed('read'), correct: summed('correct'), fields: summed('fields'),
    })
  })

  it('puts every value it reads in a plausible box', () => {
    const seen = cards.flatMap(
      (card) => parseCandidates(extractFor(card.docType, card.detections, card.text)),
    )
    // Guards the loop: nothing to check would otherwise pass.
    expect(seen).toHaveLength(summed('read'))
    for (const c of seen) {
      expect(c.box, c.key).toBeDefined()
      expect(c.evidence.boxPlausible, c.key).toBe(true)
      // A card has no checksum and we make one pass: not failed, inapplicable.
      expect(c.evidence.checksumValid, c.key).toBeNull()
      expect(c.evidence.crossPassAgreed, c.key).toBeNull()
    }
  })

  it('leaves a misread address disagreeing, however it is spaced', () => {
    const card = fixture('va_2023')
    // Mirrors the real pipeline (document-service.ts): re-space, then score.
    const [line1] = withCrossPass(
      respaceAddresses(parseCandidates(extractAamva(card.detections, card.text)), card.plainText),
      card.plainText,
    ).filter((c) => c.key === 'addr_line1')

    // The zero-for-O survives re-spacing, so the passes still disagree.
    expect(line1?.raw).toContain('0')
    expect(scoreEvidence(line1!.evidence)).toBeLessThan(QUIET_THRESHOLD)
  })
})
