import type { ImageSize } from '@/domain/ocr/geometry'

/**
 * A photo turned into the one thing the browser and the server can both talk
 * about: upright pixels, their dimensions, and the bytes that carry them.
 */
export type PreparedImage = {
  /** Bare base64 payload — no `data:` prefix, which the route refuses. */
  readonly imageBase64: string
  /** Renderable form of the same pixels, for the crops. */
  readonly imageUrl: string
  readonly imageSize: ImageSize
}

const MIME = 'image/jpeg'
const QUALITY = 0.92

/**
 * Re-encodes rather than passing the file through, because a phone photo
 * carries its rotation as an EXIF flag: the stored pixels are sideways and
 * every reader decides for itself whether to honour the flag. Drawing the
 * decoded bitmap into a canvas bakes the rotation in and drops the flag, so
 * the size measured here, the pixels the crops clip, and the bytes the server
 * maps boxes through are all the same orientation.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot open photos')
    context.drawImage(bitmap, 0, 0)

    const dataUrl = canvas.toDataURL(MIME, QUALITY)
    return {
      imageBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      imageUrl: dataUrl,
      imageSize: { width: bitmap.width, height: bitmap.height },
    }
  } finally {
    bitmap.close()
  }
}
