import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imageSizeOf, MAX_IMAGE_BASE64_CHARS } from '@/server/image-size'
import {
  APP0, DHT, jpegBase64, jpegBytes, pngBase64, pngBytes, segment, sof,
} from './image-bytes'

const REAL_JPEG = 'sample/licenses/encodings/wa_enhanced.jpg'

describe('imageSizeOf', () => {
  it('reads a PNG header', () => {
    expect(imageSizeOf(pngBase64(1600, 1000))).toEqual({ width: 1600, height: 1000 })
  })

  it('reads a JPEG by walking past the segments before the frame header', () => {
    expect(imageSizeOf(jpegBase64(4032, 3024))).toEqual({ width: 4032, height: 3024 })
  })

  it('agrees with the recorded manifest on a real specimen', () => {
    // The manifest is what the fixture corpus was captured against. If these
    // disagree, every box mapped through them lands somewhere else.
    const manifest: { image: string; size: { width: number; height: number } }[] =
      JSON.parse(readFileSync('sample/licenses/manifest.json', 'utf8'))

    for (const entry of manifest) {
      const base64 = readFileSync(entry.image).toString('base64')
      expect(imageSizeOf(base64), entry.image).toEqual(entry.size)
    }
  })
})

describe('imageSizeOf — a real JPEG, which is what a phone sends', () => {
  const bytes = readFileSync(REAL_JPEG)

  it('reads a genuine encoder\'s output, not just our own header', () => {
    // Re-encoded from wa_enhanced.png by sips, so it carries the APP1 EXIF and
    // APP13 blocks a hand-built header never has. Every specimen in the corpus
    // is a PNG; phone uploads are not.
    expect(imageSizeOf(bytes.toString('base64'))).toEqual({ width: 1560, height: 1006 })
  })

  it('agrees with the PNG it was encoded from', () => {
    const png = readFileSync('sample/licenses/specimens/wa_enhanced.png')
    expect(imageSizeOf(bytes.toString('base64')))
      .toEqual(imageSizeOf(png.toString('base64')))
  })

  it('carries the segments a hand-built fixture does not', () => {
    // Guards the guard: if the re-encode were ever replaced by something
    // stripped bare, the test above would stop testing what it claims to.
    const markers = new Set<number>()
    let at = 2
    while (at + 3 < bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1] as number
      if (marker === 0xda) break
      markers.add(marker)
      at += 2 + bytes.readUInt16BE(at + 2)
    }
    expect(markers.has(0xe1)).toBe(true)
    expect(markers.size).toBeGreaterThanOrEqual(3)
  })
})

describe('imageSizeOf — what it refuses', () => {
  it('refuses anything that is not a PNG or a JPEG', () => {
    for (const payload of [
      '', 'x', Buffer.from('GIF89a').toString('base64'),
      Buffer.from('not an image at all, just text').toString('base64'),
    ]) {
      expect(imageSizeOf(payload), payload).toBeNull()
    }
  })

  it('refuses a PNG whose first chunk is not IHDR', () => {
    const bytes = pngBytes(800, 600)
    bytes.write('IDAT', 12, 'ascii')
    expect(imageSizeOf(bytes.toString('base64'))).toBeNull()
  })

  it('refuses a well-formed IHDR behind the wrong signature', () => {
    // Every byte after the first eight says PNG. The signature is the only
    // thing that says this file is one.
    const bytes = pngBytes(800, 600)
    bytes[1] = 0x51
    expect(imageSizeOf(bytes.toString('base64'))).toBeNull()
  })

  it('refuses a PNG cut off inside its IHDR', () => {
    const bytes = pngBytes(800, 600)
    expect(imageSizeOf(bytes.subarray(0, 20).toString('base64'))).toBeNull()
  })

  it('refuses a truncated JPEG rather than looping or guessing', () => {
    const bytes = jpegBytes(APP0, sof(800, 600))
    expect(imageSizeOf(bytes.subarray(0, 12).toString('base64'))).toBeNull()
  })

  it('refuses a frame header cut off mid-dimension', () => {
    // The walk has reached the SOF and there are not enough bytes left to read
    // a width from. Reading anyway returns whatever follows the buffer.
    const bytes = jpegBytes(APP0, sof(800, 600))
    expect(imageSizeOf(bytes.subarray(0, 25).toString('base64'))).toBeNull()
  })

  it('refuses a segment whose length would not advance the walk', () => {
    // A zero length reads as "this segment ends before its own header", which
    // would walk backwards forever.
    const bytes = jpegBytes(APP0, sof(800, 600))
    bytes.writeUInt16BE(0, 4)
    expect(imageSizeOf(bytes.toString('base64'))).toBeNull()
  })

  it('refuses a walk that has lost its place rather than reading a size anyway', () => {
    // The APP0 length is overstated by one, so the next read lands inside the
    // frame header instead of on its marker. Everything after that is
    // misaligned, and a size read from there is a plausible wrong number.
    const bytes = jpegBytes(APP0, sof(800, 600))
    bytes.writeUInt16BE(bytes.readUInt16BE(4) + 1, 4)
    expect(imageSizeOf(bytes.toString('base64'))).toBeNull()
  })

  it('refuses a zero dimension, which no photo has', () => {
    expect(imageSizeOf(pngBase64(0, 1000))).toBeNull()
    expect(imageSizeOf(jpegBase64(1000, 0))).toBeNull()
  })

  it('refuses a payload past the size cap without decoding it', () => {
    expect(imageSizeOf('A'.repeat(MAX_IMAGE_BASE64_CHARS + 4))).toBeNull()
  })

  it('refuses a file that hides its frame header past the header window', () => {
    // Bounded work: the alternative is decoding an arbitrary payload in full
    // to discover it was never going to say.
    const filler = segment(0xe2, Buffer.alloc(60_000))
    const buried = jpegBytes(filler, filler, filler, filler, filler, sof(800, 600))
    expect(imageSizeOf(buried.toString('base64'))).toBeNull()
  })
})

describe('imageSizeOf — segments that are not the frame header', () => {
  it('does not mistake a huffman table for a frame header', () => {
    // DHT is 0xC4, one of the markers in the 0xC0-0xCF run that are not
    // frames. Treating it as one reads a size out of a code table.
    expect(imageSizeOf(jpegBytes(DHT, sof(1024, 768)).toString('base64')))
      .toEqual({ width: 1024, height: 768 })
  })

  it('skips fill bytes before a marker', () => {
    const padded = jpegBytes(APP0, Buffer.from([0xff, 0xff, 0xff]), sof(640, 480))
    expect(imageSizeOf(padded.toString('base64'))).toEqual({ width: 640, height: 480 })
  })

  it('steps over a standalone marker, which carries no length to skip', () => {
    // A restart marker is two bytes and nothing else. Reading the next two as
    // a length walks into the middle of the frame header.
    const withRestart = jpegBytes(APP0, Buffer.from([0xff, 0xd0]), sof(640, 480))
    expect(imageSizeOf(withRestart.toString('base64'))).toEqual({ width: 640, height: 480 })
  })

  it('reads a progressive frame header too', () => {
    expect(imageSizeOf(jpegBytes(APP0, sof(300, 200, 0xc2)).toString('base64')))
      .toEqual({ width: 300, height: 200 })
  })
})
