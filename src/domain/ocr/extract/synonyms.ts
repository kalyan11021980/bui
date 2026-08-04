/**
 * Printed field codes, per AAMVA. Data rather than code so a new state's
 * variant is a one-line change with no logic to re-read.
 *
 * Matched against a key form of the detection text — uppercased, whitespace
 * and punctuation dropped, `#` kept — so `4d.DLN`, `4d NO` and `4dLIC#` all
 * reduce to one shape. Order matters: the earlier anchor is tried first, so
 * the AAMVA code precedes the word a state spells out.
 *
 * `name_block` is the `1,2 Name` stack Virginia and Oregon print: surname on
 * the first line, given names on the second, under one code.
 */
/**
 * A licence and an ID card print the number under the same codes — CA under
 * `ID`, VA under `4d Customer number` — so both fields anchor on all of them
 * and `extractFor` picks one from `derivableFrom`. Two lists would also strip
 * unevenly: the shorter one leaves `LIC#` on the front of the value.
 */
const DOCUMENT_NUMBER: readonly string[] = [
  '4D', 'LIC#', 'DLN', 'CUSTOMERNUMBER', 'LICENSENO', 'LICNO', 'DLNO',
  'NUMBER', 'NO', 'DL', 'ID',
]

export const AAMVA_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  dl_number: DOCUMENT_NUMBER,
  id_number: DOCUMENT_NUMBER,
  dob: ['3', 'DOB', 'DATEOFBIRTH', 'BIRTHDATE'],
  dl_expiry: ['4B', 'EXP', 'EPX', 'EXPIRES'],
  last_name: ['1', 'LN', 'FAMILYNAME'],
  first_name: ['2', 'FN', 'GIVENNAMES'],
  name_block: ['12', 'NAME'],
  address_block: ['8', 'ADDRESS', 'ADD'],
}

/**
 * Every numbered code these cards print, including the ones we do not read.
 * Two jobs: a short code never wins over a longer one that also fits (`1` must
 * not claim `15 SEX`), and a detection that opens with a code is a label, so
 * it is not a value for the field beside it.
 */
export const LABEL_CODES: readonly string[] = [
  '1', '2', '3', '4A', '4B', '4D', '5', '6', '8', '9',
  '10', '11', '12', '15', '16', '17', '18',
]

/** Words printed as labels on these cards. Never a value. */
export const LABEL_WORDS: readonly string[] = [
  'LIC#', 'DLN', 'DL', 'ID', 'NUMBER', 'CUSTOMERNUMBER', 'LICENSENO',
  'NAME', 'FAMILYNAME', 'GIVENNAMES', 'LN', 'FN',
  'ADDRESS', 'ADD', 'DOB', 'DATEOFBIRTH', 'BIRTHDATE',
  'EXP', 'EPX', 'EXPIRES', 'ISS', 'ISSUED', 'DD',
  'CLASS', 'REST', 'RESTRICTIONS', 'END', 'ENDORSEMENTS', 'NONE',
  'SEX', 'HGT', 'HEIGHT', 'WGT', 'WEIGHT', 'EYES', 'HAIR',
  'DONOR', 'VETERAN', 'USA', 'SIGNATURE',
]

/** A code followed by more digits is a longer number, not that code. */
function codeAt(text: string, code: string): boolean {
  if (!text.startsWith(code)) return false
  if (!/^\d+$/.test(code)) return true
  return !/\d/.test(text.charAt(code.length))
}

/**
 * A detection that opens with a printed label is never the value beside it.
 * Shared rather than reimplemented per strategy, but each caller supplies its
 * own vocabulary: `LABEL_WORDS` carries AAMVA's short card codes (`DL`,
 * `ID`, `LN`...), and those are dangerous prefixes for a labelled document's
 * free-form identifiers — a dealer licence number like `DLR-0000-4471`
 * starts with `DL` too. `LABELLED_LABEL_WORDS` below is deliberately a
 * separate, shorter list for exactly that reason.
 */
export function isLabel(
  text: string,
  words: readonly string[] = LABEL_WORDS,
  codes: readonly string[] = LABEL_CODES,
): boolean {
  return codes.some((c) => codeAt(text, c)) || words.some((w) => text.startsWith(w))
}

/**
 * `LICENCENUMBER` (British spelling, spelled-out "Number") covers a spelling
 * variant `LICENCENO` alone does not — it is the "-CE" letters that vary,
 * not the "No." abbreviation.
 */
export const LABELLED_ANCHORS: Readonly<Record<string, readonly string[]>> = {
  license_number: ['LICENSENO', 'LICENSENUMBER', 'LIC#', 'LICENCENO', 'LICENCENUMBER', 'DEALERNO'],
  license_effective: ['EFFECTIVE', 'ISSUED', 'ISSUEDATE', 'VALIDFROM'],
  license_expiry: ['EXPIRES', 'EXPIRATION', 'VALIDTHROUGH', 'VALIDUNTIL'],
  biz_legal_name: ['LEGALNAME', 'BUSINESSNAME', 'ENTITYNAME', 'DBA'],
}

/**
 * The labels a dealer licence or proof-of-residency document prints,
 * spelled out in full English words rather than AAMVA's short card codes.
 * `LABEL_WORDS`' two-letter codes (`DL`, `ID`, `LN`...) are exactly the kind
 * of prefix a licence number collides with by coincidence — this list stays
 * free of anything shorter than a real English word for that reason.
 */
export const LABELLED_LABEL_WORDS: readonly string[] = [
  'LICENSE', 'BUSINESS', 'DOING', 'TYPE', 'DATE',
  'NUMBER', 'NAME', 'ADDRESS', 'EFFECTIVE', 'EXPIRATION',
]
