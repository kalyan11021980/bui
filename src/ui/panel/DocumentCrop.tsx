import type { ImageSize } from '@/domain/ocr/geometry'

type Props = {
  imageUrl: string | undefined
  box: readonly [number, number, number, number]
  imageSize: ImageSize | undefined
  alt: string
}

const DISPLAY_WIDTH = 260

/**
 * Clips the original in the browser rather than cutting a crop server-side —
 * the image is never uploaded anywhere it could be stored.
 *
 * Exposed to assistive tech as a single labelled `role="img"`, not a bare
 * `<img>`: the pixels underneath carry no information a sighted user has
 * that isn't already stated as text elsewhere on the row (the field value,
 * the provenance sentence), so the crop's accessible form is that label —
 * "here is the region this was read from" — not a transcription of pixels.
 * The clipped `<img>` itself is `aria-hidden` so it isn't announced twice.
 */
export function DocumentCrop({ imageUrl, box, imageSize, alt }: Props) {
  if (!imageUrl || !imageSize) return null

  const [x0, y0, x1, y1] = box
  const width = x1 - x0
  const height = y1 - y0
  if (width <= 0 || height <= 0) return null

  const scale = Math.min(DISPLAY_WIDTH / width, 3)

  return (
    <div
      role="img"
      aria-label={alt}
      style={{
        width: width * scale, height: height * scale,
        marginTop: 6, overflow: 'hidden', position: 'relative',
      }}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden
        style={{
          position: 'absolute',
          width: imageSize.width * scale, height: imageSize.height * scale,
          left: -x0 * scale, top: -y0 * scale, maxWidth: 'none',
        }}
      />
    </div>
  )
}
