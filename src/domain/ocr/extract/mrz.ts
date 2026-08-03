import { isRealCalendarDate } from '@/domain/calendar'
import type { Detection } from '../grounding'
import { registerStrategy } from './index'
import { glyphAmbiguity, NO_EVIDENCE, type Candidate, type ExtractStrategy } from './types'

const WEIGHTS = [7, 3, 1]

// Line 1 needs no fixed offsets beyond the document code and country: names
// are read by splitting on '<<' at whatever length OCR returned. `P<` alone
// would also match page headers like "PASSPORT" — the filler after the
// document code rules those out.
const LINE1 = /^P<[A-Z]{3}/

// The 28 characters this strategy reads off line 2: doc number, its check
// digit, nationality, DOB, its check digit, sex, expiry, its check digit.
// A length gate alone lets a shifted line through; this is anchored on
// structure instead, so a digit landing in the alphabetic nationality slot
// (or a letter landing in a digit slot) is rejected.
const LINE2 = /^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}\d[MF<]\d{6}\d/

/** ICAO Doc 9303: digits by value, letters A-Z as 10-35, filler as 0. */
export function checkDigit(input: string): string {
  let sum = 0
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? '<'
    const value = char === '<'
      ? 0
      : char >= '0' && char <= '9'
        ? Number(char)
        : char.charCodeAt(0) - 55
    sum += value * (WEIGHTS[i % 3] ?? 1)
  }
  return String(sum % 10)
}

/**
 * Each MRZ line is its own grounded detection; `text` is the raw markup
 * around them and is never parsed directly.
 */
export function findMrzLines(
  detections: readonly Detection[],
): readonly [string, string] | null {
  const texts = detections.map((d) => d.text.replace(/\s+/g, '').toUpperCase())
  const line1 = texts.find((t) => LINE1.test(t))
  const line2 = texts.find((t) => LINE2.test(t))
  return line1 && line2 ? [line1, line2] : null
}

/** YYMMDD with the 30-year window ICAO uses for expiry versus birth. */
function toIsoDate(yymmdd: string, kind: 'past' | 'future'): string | null {
  const year = Number(yymmdd.slice(0, 2))
  const month = yymmdd.slice(2, 4)
  const day = yymmdd.slice(4, 6)
  if (Number.isNaN(year)) return null
  const century = kind === 'past' ? (year > 30 ? 1900 : 2000) : 2000
  const iso = `${century + year}-${month}-${day}`
  return isRealCalendarDate(iso) ? iso : null
}

export const extractMrz: ExtractStrategy = (detections) => {
  const lines = findMrzLines(detections)
  if (!lines) return []
  const [line1, line2] = lines

  const out: Candidate[] = []
  const emit = (key: string, raw: string | null, checksumValid: boolean | null) => {
    if (!raw) return
    out.push({
      key,
      raw,
      evidence: { ...NO_EVIDENCE, checksumValid, glyphAmbiguous: glyphAmbiguity(key, raw) },
    })
  }

  // Names and the issuing country carry no check digit of their own — the
  // composite on line 2 covers the document number, DOB and expiry only.
  const names = line1.slice(5).split('<<')
  const surname = (names[0] ?? '').replace(/</g, ' ').trim()
  const given = (names[1] ?? '').split('<')[0]?.trim() ?? ''
  if (surname) emit('last_name', surname, null)
  if (given) emit('first_name', given, null)

  const country = line1.slice(2, 5).replace(/</g, '')
  if (country) emit('id_country', country, null)

  // The one identifier here that carries its own check digit. Task 6b added
  // the field; without this the MRZ's strongest value goes nowhere.
  const number = line2.slice(0, 9).replace(/</g, '')
  if (checkDigit(line2.slice(0, 9)) === line2[9]) emit('passport_number', number, true)

  const dob = line2.slice(13, 19)
  if (checkDigit(dob) === line2[19]) emit('dob', toIsoDate(dob, 'past'), true)

  const expiry = line2.slice(21, 27)
  if (checkDigit(expiry) === line2[27]) emit('dl_expiry', toIsoDate(expiry, 'future'), true)

  return out
}

registerStrategy('passport', extractMrz)
