import { describe, expect, it } from 'vitest'
import {
  extractAamva, respaceAddress, respaceAddresses, splitAddressBlock,
} from '@/domain/ocr/extract/aamva'
import { extractFor, NO_EVIDENCE, parseCandidates } from '@/domain/ocr/extract'
import type { Detection } from '@/domain/ocr/grounding'

const det = (text: string, box: [number, number, number, number]): Detection =>
  ({ text, box })

const read = (detections: Detection[], key: string) =>
  extractAamva(detections, '').find((c) => c.key === key)

describe('extractAamva', () => {
  it('reads a licence number anchored to its field code', () => {
    const detections = [det('4dLIC#WDLJK00580GF', [100, 200, 400, 230])]
    expect(read(detections, 'dl_number')?.raw).toBe('WDLJK00580GF')
  })

  it('picks the labelled occurrence when the number is printed twice', () => {
    // Washington prints it as `4d LIC#` at the top and `5 DD` at the bottom.
    // Value alone picks the wrong one about half the time.
    const labelled = det('4dLIC#WDLJK00580GF', [100, 200, 400, 230])
    const repeat = det('5DDWDLJK00580GF', [100, 700, 400, 730])

    for (const order of [[labelled, repeat], [repeat, labelled]]) {
      const found = read(order, 'dl_number')
      expect(found?.box).toEqual([100, 200, 400, 230])
      expect(found?.evidence.labelAnchored).toBe(true)
    }
  })

  it('ignores a bare repeat of the number even when it comes first', () => {
    // The tighter box: whatever wins here, it is not because it was shortest.
    const found = read([
      det('WDLJK00580GF', [100, 700, 300, 730]),
      det('4dLIC#WDLJK00580GF', [100, 200, 400, 230]),
    ], 'dl_number')
    expect(found?.box).toEqual([100, 200, 400, 230])
  })

  it('reads dates into ISO form', () => {
    const detections = [det('3 DOB 04/17/1982', [100, 300, 400, 330])]
    const found = read(detections, 'dob')
    expect(found?.raw).toBe('1982-04-17')
    // Cross-pass compares this against the printed form; the plain OCR pass
    // never saw the ISO conversion.
    expect(found?.asRead).toBe('04/17/1982')
  })

  it('rejects a calendar-invalid date, not just a badly shaped one', () => {
    // A card has no check digit to catch a misread digit; the calendar
    // check is the only guard this format has. Downstream schema validation
    // would drop it too, but the extractor should not manufacture it.
    const detections = [det('3 DOB 13/45/1982', [100, 300, 400, 330])]
    expect(read(detections, 'dob')).toBeUndefined()
  })

  it('marks a box covering the whole card as implausible', () => {
    const detections = [det('4dLIC#WDLJK00580GF', [0, 0, 1000, 1000])]
    expect(read(detections, 'dl_number')?.evidence.boxPlausible).toBe(false)
  })

  it('emits nothing for a field whose anchor is absent', () => {
    const out = extractAamva([det('SOMETHING ELSE', [0, 0, 10, 10])], '')
    expect(out).toEqual([])
  })

  it('takes the value from the detection beside the code', () => {
    // Oregon prints `4d NO` and the number as two detections on one row.
    const found = read([
      det('4dNO', [394, 257, 440, 285]),
      det('A123456', [450, 255, 575, 303]),
      det('12CARD', [394, 311, 509, 351]),
    ], 'dl_number')
    expect(found?.raw).toBe('A123456')
    expect(found?.box).toEqual([450, 255, 575, 303])
  })

  it('takes the value from the detection under the code', () => {
    // Massachusetts stacks `4d NUMBER` over the number.
    const found = read([
      det('4dNUMBER', [731, 279, 845, 312]),
      det('S99988801', [761, 312, 958, 358]),
      det('01/12/1959', [761, 399, 955, 455]),
    ], 'dl_number')
    expect(found?.raw).toBe('S99988801')
  })

  it('reads the expiry under DC’s EPX spelling', () => {
    const found = read([
      det('4b.EPX', [538, 220, 592, 246]),
      det('02/21/2018', [538, 250, 655, 284]),
    ], 'dl_expiry')
    expect(found?.raw).toBe('2018-02-21')
    expect(found?.asRead).toBe('02/21/2018')
  })

  it('splits the 1,2 name stack into surname then given names', () => {
    // Virginia prints one code over two lines.
    const detections = [
      det('1,2 Name', [320, 312, 404, 343]),
      det('REYES', [360, 341, 447, 379]),
      det('RICHARD BENJAMIN', [360, 377, 570, 408]),
    ]
    expect(read(detections, 'last_name')?.raw).toBe('REYES')
    expect(read(detections, 'first_name')?.raw).toBe('RICHARD')
  })

  it('does not take a word that merely starts with a code as the value', () => {
    // The MA card with its `4d NUMBER` label lost to OCR, which is the same
    // label loss this corpus already shows elsewhere. `NO` must not claim
    // NORTHQUINCY: a city in the licence-number field, every signal green.
    const detections = [
      det('01/12/2016', [570, 310, 724, 356]),
      det('S99988801', [761, 312, 958, 358]),
      det('NORTHQUINCY,MA02171-1748', [425, 727, 796, 769]),
    ]
    expect(read(detections, 'dl_number')).toBeUndefined()
  })

  it('does not read an ordinal in a street as a field code', () => {
    // `1ST FLOOR` opens with a 1, which is the surname code.
    expect(read([det('1ST FLOOR', [400, 500, 600, 530])], 'last_name')).toBeUndefined()
    expect(read([det('12TH STREET', [400, 500, 600, 530])], 'last_name')).toBeUndefined()
  })

  it('still reads a code printed flush against its value', () => {
    // California prints `LN SAMPLE` and OCR returns it with no space at all,
    // so the boundary rule cannot be blanket.
    expect(read([det('LNCARDHOLDER', [334, 369, 599, 419])], 'last_name')?.raw)
      .toBe('CARDHOLDER')
    expect(read([det('DL11234568', [329, 214, 560, 284])], 'dl_number')?.raw)
      .toBe('11234568')
  })

  it('keeps only the first of the given names', () => {
    // The card prints FIRST MIDDLE on one line; we have a field for the first.
    expect(read([det('2 OREGON SAMPLE, SR', [400, 300, 700, 340])], 'first_name')?.raw)
      .toBe('OREGON')
  })

  it('does not read a printed label as if it were a name', () => {
    // `12 REST` sits under the same code family as `1,2 Name`.
    const detections = [
      det('12REST', [618, 452, 704, 485]),
      det('NONE', [660, 481, 733, 520]),
    ]
    expect(read(detections, 'last_name')).toBeUndefined()
    expect(read(detections, 'first_name')).toBeUndefined()
  })

  it('reads an address block anchored to code 8', () => {
    const detections = [
      det('8123STREETADDRESS', [339, 499, 656, 540]),
      det('YOURCITYWA99999-0000', [353, 540, 713, 575]),
    ]
    expect(read(detections, 'addr_city')?.raw).toBe('YOURCITY')
    expect(read(detections, 'addr_state')?.raw).toBe('WA')
    expect(read(detections, 'addr_zip')?.raw).toBe('99999-0000')
    expect(read(detections, 'addr_line1')?.raw).toBe('123STREETADDRESS')
  })

  it('falls back to the city/state/ZIP shape, and says it was not labelled', () => {
    const detections = [
      det('123 NORTH MAIN STREET', [401, 644, 704, 688]),
      det('NORTHQUINCY,MA02171-1748', [425, 727, 796, 769]),
    ]
    const city = read(detections, 'addr_city')
    expect(city?.raw).toBe('NORTHQUINCY')
    expect(city?.evidence.labelAnchored).toBe(false)
  })

  it('keeps the street when an apartment line sits between it and the city', () => {
    // Taking one line above the city gives APT. 1 and posts the title
    // documents nowhere.
    const detections = [
      det('CONNOR', [401, 601, 536, 644]),
      det('123NORTHMAINSTREET', [401, 644, 704, 688]),
      det('APT.1', [425, 690, 516, 727]),
      det('NORTHQUINCY,MA02171-1748', [425, 727, 796, 769]),
    ]
    expect(read(detections, 'addr_line1')?.raw).toBe('123NORTHMAINSTREET APT.1')
  })

  it('does not take a date line as the start of a street', () => {
    // A street opens with a house number, and so does 01/12/2016.
    const detections = [
      det('01/12/2016', [401, 600, 704, 640]),
      det('MAIN STREET', [401, 644, 704, 688]),
      det('NORTHQUINCY,MA02171-1748', [425, 727, 796, 769]),
    ]
    expect(read(detections, 'addr_line1')?.raw).toBe('MAIN STREET')
  })

  it('does not take a date line as the street under an address code', () => {
    // The walk down from code 8 takes the lines under it in order, and an
    // issue date printed between the code and the street is first in that
    // order. `labelAnchored` pins this to the anchored walk, not the fallback.
    const detections = [
      det('8Address', [333, 442, 425, 473]),
      det('01/12/2016', [340, 475, 500, 505]),
      det('123NORTHMAINSTREET', [340, 508, 600, 538]),
      det('NORTHQUINCY,MA02171-1748', [340, 540, 620, 570]),
    ]
    const line1 = read(detections, 'addr_line1')
    expect(line1?.raw).toBe('123NORTHMAINSTREET')
    expect(line1?.evidence.labelAnchored).toBe(true)
  })

  it('does not reach across the card for a value', () => {
    // A tall ghost column to the right overlaps the label's row without ever
    // being beside it — ma_2016 prints exactly such a band.
    expect(read([
      det('3DOB', [600, 800, 660, 830]),
      det('01/12/2016', [700, 100, 860, 820]),
    ], 'dob')).toBeUndefined()

    // A full-width line under a right-hand label overlaps its column without
    // being under it.
    expect(read([
      det('4bEXP', [800, 500, 860, 530]),
      det('01/12/2021', [100, 560, 850, 600]),
    ], 'dl_expiry')).toBeUndefined()
  })

  it('does not take two letters of a city as the state', () => {
    // `ANYTOWN95818` would otherwise split into ANYTO / WN / 95818, and
    // addr_state validation is only "two characters".
    const detections = [
      det('2570 24TH STREET', [334, 479, 560, 519]),
      det('ANYTOWN95818', [334, 524, 539, 559]),
    ]
    expect(read(detections, 'addr_state')).toBeUndefined()
    expect(read(detections, 'addr_zip')).toBeUndefined()
  })
})

describe('an ID card carries a number of its own', () => {
  it('reads it from the `ID` code California prints', () => {
    // The card prints `ID  I1234561`; OCR returns the pair as one detection.
    expect(read([det('ID11234561', [347, 192, 588, 255])], 'id_number')?.raw)
      .toBe('11234561')
  })

  it('reads it from the `4d Customer number` Virginia spells out', () => {
    const found = read([
      det('4dCustomer number', [332, 230, 514, 261]),
      det('T16700487', [364, 257, 536, 299]),
    ], 'id_number')
    expect(found?.raw).toBe('T16700487')
    expect(found?.evidence.labelAnchored).toBe(true)
  })

  it('does not read the IDENTIFICATION heading as an ID number', () => {
    // `ID` opens the word, and the card title sits above the number.
    expect(read([
      det('IDENTIFICATION', [584, 48, 840, 96]),
      det('CARD', [664, 98, 764, 140]),
    ], 'id_number')).toBeUndefined()
  })
})

describe('glyph ambiguity is recorded, never used to filter', () => {
  it('flags an identifier holding a mutually confusable glyph', () => {
    // The acceptance gate's worst finding: I1234568 read as 11234568, a
    // plausible wrong value with every other signal green.
    expect(read([det('DL11234568', [329, 214, 560, 284])], 'dl_number')
      ?.evidence.glyphAmbiguous).toBe(true)
  })

  it('does not flag an identifier with no confusable glyph in it', () => {
    // Without this the signal could be a constant and still look like it works.
    const found = read([det('4dLIC#A9999999', [100, 200, 400, 230])], 'dl_number')
    expect(found?.raw).toBe('A9999999')
    expect(found?.evidence.glyphAmbiguous).toBe(false)
  })

  it('leaves it null on a name, a date and an address', () => {
    const detections = [
      det('1,2 Name', [320, 312, 404, 343]),
      det('REYES', [360, 341, 447, 379]),
      det('RICHARD BENJAMIN', [360, 377, 570, 408]),
      det('3 DOB 04/17/1982', [100, 500, 400, 530]),
      det('8123STREETADDRESS', [339, 599, 656, 640]),
      det('YOURCITYWA99999-0000', [353, 640, 713, 675]),
    ]
    for (const field of ['last_name', 'first_name', 'dob', 'addr_line1', 'addr_city']) {
      expect(read(detections, field)?.evidence.glyphAmbiguous, field).toBeNull()
    }
  })

  it('still emits the ambiguous value, all the way through parsing', () => {
    // Subtract-only. A value we are less sure of is not a malformed one, and
    // dropping it would leave the field blank with no record of why.
    const detections = [det('DL11234568', [329, 214, 560, 284])]
    const kept = parseCandidates(extractFor('drivers_license', detections, ''))
    expect(kept.map((c) => c.raw)).toEqual(['11234568'])
    expect(kept[0]?.evidence.glyphAmbiguous).toBe(true)
  })
})

describe('the catalog decides what a document may prove', () => {
  const detections = [det('4dLIC#WDLJK00580GF', [100, 200, 400, 230])]

  it('keeps a licence number read off a licence', () => {
    const keys = extractFor('drivers_license', detections, '').map((c) => c.key)
    expect(keys).toContain('dl_number')
  })

  it('drops the same read off a state ID, which does not derive dl_number', () => {
    expect(read(detections, 'dl_number')?.raw).toBe('WDLJK00580GF')
    const keys = extractFor('state_id', detections, '').map((c) => c.key)
    expect(keys).not.toContain('dl_number')
  })

  it('files the same number under id_number when the card is a state ID', () => {
    // The strategy reads both and is never told which document it is looking
    // at; `derivableFrom` is what picks one.
    expect(extractFor('state_id', detections, '').map((c) => c.key))
      .toEqual(['id_number'])
    expect(extractFor('drivers_license', detections, '').map((c) => c.key))
      .toEqual(['dl_number'])
  })
})

describe('splitAddressBlock', () => {
  it('splits a two-line address block', () => {
    const parts = splitAddressBlock('2600 MARTIN WAY E\nOLYMPIA, WA 98506')
    expect(parts).toEqual({
      line1: '2600 MARTIN WAY E', city: 'OLYMPIA', state: 'WA', zip: '98506',
    })
  })

  it('handles a ZIP+4', () => {
    expect(splitAddressBlock('1 A ST\nBOSTON, MA 02101-1234').zip).toBe('02101-1234')
  })

  it('splits a line the grounded output has stripped of spaces', () => {
    expect(splitAddressBlock('123STREETADDRESS\nYOURCITYWA99999-0000')).toEqual({
      line1: '123STREETADDRESS', city: 'YOURCITY', state: 'WA', zip: '99999-0000',
    })
  })

  it('returns nothing usable from a malformed block', () => {
    expect(splitAddressBlock('ANYTOWN,CAPO')).toEqual({})
  })

  it('does not invent a state from the last two letters of the city', () => {
    expect(splitAddressBlock('1 A ST\nANYTOWN95818')).toEqual({})
    expect(splitAddressBlock('1 A ST\nSPRINGFIELD 62704')).toEqual({})
  })
})

describe('respaceAddress', () => {
  it('borrows word breaks from the plain pass', () => {
    expect(respaceAddress('123STREETADDRESS', '123 Street Address')).toBe('123 STREET ADDRESS')
  })

  it('never substitutes a glyph, even where the plain pass reads differently', () => {
    // The grounded pass's own zero survives — the plain pass's letter O is
    // never copied over it. This is the safety condition the whole task
    // exists for: see task-15-brief.md.
    const respaced = respaceAddress('5235J0HNTYLERHWY', '5235 JOHN TYLER HWY')
    expect(respaced).toBe('5235 J0HN TYLER HWY')
    expect(respaced).toContain('0')
    expect(respaced).not.toContain('JOHN')
  })

  it('never removes a space the grounded pass already had', () => {
    // A street the grounded pass already broke into words correctly must not
    // be re-merged because the plain pass happens to print it run together —
    // re-spacing may only add whitespace, never take it away.
    expect(respaceAddress('1906 LANA AVE NE', 'DL 1906LANA AVENE SALEM OR'))
      .toBe('1906 LANA AVE NE')
    expect(respaceAddress('123 MAIN ST', '123MAINST APT 4')).toBe('123 MAIN ST')
  })

  it('leaves the value unspaced when the plain pass has nothing that lines up', () => {
    // Real case: ma_2016's plain pass drops the house number entirely, so
    // no window of the full value's length can align without guessing. The
    // corpus value already carries the join-space between the two lines.
    const raw = '123NORTHMAINSTREET APT.1'
    const unrelated = 'North Main Street, Apt. 1'
    expect(respaceAddress(raw, unrelated)).toBe(raw)
  })

  it('leaves the value unspaced against text with no correspondence at all', () => {
    const raw = '123STREETADDRESS'
    expect(respaceAddress(raw, 'completely unrelated text with no bearing here')).toBe(raw)
  })

  it('prefers the window that reads as whole words, not just the one with fewest mismatches', () => {
    // Two equally-exact windows exist in each text: an accidental one built
    // from fragments of unrelated words, and the real one printed as a
    // single word. Picking the first (earliest) or either arbitrarily can
    // pick the fragment and garble a value that was already correct.
    expect(respaceAddress('QUINCY', 'QUIN CY? NORTH QUINCY MA 02171')).toBe('QUINCY')
    expect(respaceAddress('WASHINGTON', 'WASH INGTON DC DEPT WASHINGTON DC 20001'))
      .toBe('WASHINGTON')
  })

  it('keeps the mismatch ratio at 0.3, not something looser', () => {
    // A 10-character span with exactly 4 mismatches (40%) sits between the
    // current 30% cutoff (rejects) and a looser 50% one (would accept and
    // insert the space after "ABCDE") — pins the constant itself, not just
    // its existence.
    const raw = 'ABCDEFGHIJ'
    const plainText = 'FILLER AXCXE XGXIJ FILLER'
    expect(respaceAddress(raw, plainText)).toBe(raw)
  })

  it('is a no-op with no plain pass, or nothing to space', () => {
    expect(respaceAddress('123STREETADDRESS', '')).toBe('123STREETADDRESS')
    expect(respaceAddress('', 'some text')).toBe('')
  })
})

describe('respaceAddresses', () => {
  it('re-spaces only free-text address fields, leaving state and zip alone', () => {
    const candidates = [
      { key: 'addr_line1', raw: '123STREETADDRESS', evidence: NO_EVIDENCE },
      { key: 'addr_city', raw: 'YOURCITY', evidence: NO_EVIDENCE },
      { key: 'addr_state', raw: 'WA', evidence: NO_EVIDENCE },
      { key: 'addr_zip', raw: '99999-0000', evidence: NO_EVIDENCE },
      { key: 'last_name', raw: 'SAMPLE', evidence: NO_EVIDENCE },
    ]
    const plainText = '123 Street Address\nYour City WA 99999-0000'
    const out = respaceAddresses(candidates, plainText)

    expect(out.find((c) => c.key === 'addr_line1')?.raw).toBe('123 STREET ADDRESS')
    expect(out.find((c) => c.key === 'addr_city')?.raw).toBe('YOUR CITY')
    expect(out.find((c) => c.key === 'addr_state')?.raw).toBe('WA')
    expect(out.find((c) => c.key === 'addr_zip')?.raw).toBe('99999-0000')
    expect(out.find((c) => c.key === 'last_name')?.raw).toBe('SAMPLE')
  })
})
