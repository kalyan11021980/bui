/** Header-only PNG and JPEG payloads: enough bytes to carry real dimensions. */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function pngBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from(PNG_SIGNATURE).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

export function pngBase64(width: number, height: number): string {
  return pngBytes(width, height).toString('base64')
}

/** A marker segment: FF, the marker, its own 2-byte length, then the payload. */
export function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt16BE(0xff00 | marker, 0)
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([head, payload])
}

export const APP0 = segment(
  0xe0,
  Buffer.concat([Buffer.from('JFIF\0', 'ascii'), Buffer.alloc(9)]),
)

/** A huffman table: not a frame header, however close its marker looks. */
export const DHT = segment(0xc4, Buffer.alloc(28, 0x11))

export function sof(width: number, height: number, marker = 0xc0): Buffer {
  const payload = Buffer.alloc(15)
  payload[0] = 8
  payload.writeUInt16BE(height, 1)
  payload.writeUInt16BE(width, 3)
  payload[5] = 3
  return segment(marker, payload)
}

/** SOI, then whatever segments the case needs. */
export function jpegBytes(...parts: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts])
}

/** The ordinary case: one app segment the walk has to skip, then the frame. */
export function jpegBase64(width: number, height: number): string {
  return jpegBytes(APP0, sof(width, height)).toString('base64')
}
