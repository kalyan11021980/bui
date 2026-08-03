import type { ImageSize } from '@/domain/ocr/geometry'

/**
 * Dimensions read from the bytes, never from the caller. The server maps every
 * OCR box through these numbers and gates the quality band on the width, so a
 * client-supplied size is both a silent way to misplace every crop and a way to
 * talk a 300px photo past the read floor.
 *
 * TODO(phase-2): EXIF orientation is not read. A phone photo with a rotation
 * flag decodes to swapped dimensions, which moves every box. The fix belongs in
 * the upload control — it should re-encode to the orientation it displays, so
 * the browser and the server share one coordinate space.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Every JPEG start-of-frame. Not SOF4/8/12 — those are not frame headers. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/** Standalone markers: no length field follows, so nothing to skip over. */
const STANDALONE = new Set([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])

/** The dimensions of a PNG or JPEG payload, or null for anything else. */
export function imageSizeOf(imageBase64: string): ImageSize | null {
  const bytes = Buffer.from(imageBase64, 'base64')
  return pngSize(bytes) ?? jpegSize(bytes)
}

function pngSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 24) return null
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  // IHDR is required to be the first chunk; width and height are big-endian
  // uint32 at byte offsets 16 and 20.
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return positive(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
}

function jpegSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let at = 2
  while (at + 3 < bytes.length) {
    // Fill bytes: any number of 0xFF may pad the gap before a marker.
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] as number
    if (marker === 0xff) { at += 1; continue }
    if (STANDALONE.has(marker)) { at += 2; continue }

    const length = bytes.readUInt16BE(at + 2)
    // A segment shorter than its own length field would not advance the walk.
    if (length < 2) return null
    if (!SOF_MARKERS.has(marker)) { at += 2 + length; continue }

    // SOF payload: precision, height, width.
    if (at + 9 > bytes.length) return null
    return positive(bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5))
  }

  return null
}

function positive(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null
}
