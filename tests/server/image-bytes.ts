/** Header-only PNG and JPEG payloads: enough bytes to carry real dimensions. */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function pngBase64(width: number, height: number): string {
  const bytes = Buffer.alloc(33)
  Buffer.from(PNG_SIGNATURE).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[24] = 8
  bytes[25] = 6
  return bytes.toString('base64')
}

/** SOI, then an APP0 the walk has to skip over, then SOF0. */
export function jpegBase64(width: number, height: number): string {
  const app0 = Buffer.alloc(18)
  app0.writeUInt16BE(0xffe0, 0)
  app0.writeUInt16BE(16, 2)
  app0.write('JFIF', 4, 'ascii')

  const sof0 = Buffer.alloc(21)
  sof0.writeUInt16BE(0xffc0, 0)
  sof0.writeUInt16BE(17, 2)
  sof0[4] = 8
  sof0.writeUInt16BE(height, 5)
  sof0.writeUInt16BE(width, 7)
  sof0[9] = 3

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]).toString('base64')
}
