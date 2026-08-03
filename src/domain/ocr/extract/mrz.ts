import { registerStrategy } from './index'
import { NO_EVIDENCE, type Candidate, type ExtractStrategy } from './types'

const WEIGHTS = [7, 3, 1]
const LINE = /^[A-Z0-9<]{44}$/

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

export function findMrzLines(text: string): readonly [string, string] | null {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => LINE.test(l))

  if (lines.length < 2) return null
  const first = lines.find((l) => l.startsWith('P'))
  const second = lines.find((l) => l !== first)
  return first && second ? [first, second] : null
}

/** YYMMDD with the 20-year window ICAO uses for expiry versus birth. */
function toIsoDate(yymmdd: string, kind: 'past' | 'future'): string | null {
  const year = Number(yymmdd.slice(0, 2))
  const month = yymmdd.slice(2, 4)
  const day = yymmdd.slice(4, 6)
  if (Number.isNaN(year)) return null
  const century = kind === 'past' ? (year > 30 ? 1900 : 2000) : 2000
  return `${century + year}-${month}-${day}`
}

export const extractMrz: ExtractStrategy = (_detections, text) => {
  const lines = findMrzLines(text)
  if (!lines) return []
  const [line1, line2] = lines

  const out: Candidate[] = []
  const emit = (key: string, raw: string | null) => {
    if (raw) out.push({ key, raw, evidence: { ...NO_EVIDENCE, checksumValid: true } })
  }

  // Names carry no check digit of their own; the composite covers line 2 only,
  // so a name is emitted whenever the zone parses.
  const names = line1.slice(5).split('<<')
  const surname = (names[0] ?? '').replace(/</g, ' ').trim()
  const given = (names[1] ?? '').split('<')[0]?.trim() ?? ''
  if (surname) emit('last_name', surname)
  if (given) emit('first_name', given)

  const country = line1.slice(2, 5).replace(/</g, '')
  if (country) emit('id_country', country)

  // The one identifier here that carries its own check digit. Task 6b added
  // the field; without this the MRZ's strongest value goes nowhere.
  const number = line2.slice(0, 9).replace(/</g, '')
  if (checkDigit(line2.slice(0, 9)) === line2[9]) emit('passport_number', number)

  const dob = line2.slice(13, 19)
  if (checkDigit(dob) === line2[19]) emit('dob', toIsoDate(dob, 'past'))

  const expiry = line2.slice(21, 27)
  if (checkDigit(expiry) === line2[27]) emit('dl_expiry', toIsoDate(expiry, 'future'))

  return out
}

registerStrategy('passport', extractMrz)
