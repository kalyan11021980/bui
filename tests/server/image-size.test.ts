import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imageSizeOf } from '@/server/image-size'
import { jpegBase64, pngBase64 } from './image-bytes'

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

  it('refuses anything that is not a PNG or a JPEG', () => {
    for (const payload of [
      '', 'x', Buffer.from('GIF89a').toString('base64'),
      Buffer.from('not an image at all, just text').toString('base64'),
    ]) {
      expect(imageSizeOf(payload), payload).toBeNull()
    }
  })

  it('refuses a PNG whose first chunk is not IHDR', () => {
    const bytes = Buffer.from(pngBase64(800, 600), 'base64')
    bytes.write('IDAT', 12, 'ascii')
    expect(imageSizeOf(bytes.toString('base64'))).toBeNull()
  })

  it('refuses a truncated JPEG rather than looping or guessing', () => {
    const bytes = Buffer.from(jpegBase64(800, 600), 'base64')
    expect(imageSizeOf(bytes.subarray(0, 12).toString('base64'))).toBeNull()
  })

  it('refuses a JPEG segment whose length would not advance the walk', () => {
    // A zero length reads as "this segment is before its own header", which
    // would walk backwards forever.
    const bytes = Buffer.from(jpegBase64(800, 600), 'base64')
    bytes.writeUInt16BE(0, 4)
    expect(imageSizeOf(bytes.toString('base64'))).toBeNull()
  })

  it('refuses a zero dimension, which no photo has', () => {
    expect(imageSizeOf(pngBase64(0, 1000))).toBeNull()
    expect(imageSizeOf(jpegBase64(1000, 0))).toBeNull()
  })
})
