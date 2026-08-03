import type { ImageSize } from '@/domain/ocr/geometry'

/** A photo this browser holds, kept only to clip crops out of. */
export type DocumentImage = { url: string; size: ImageSize }

/**
 * Every document uploaded this session, under the id the server filed it as.
 * Keyed rather than single: a value read from the licence must keep showing
 * the licence once a second document is uploaded, and a value whose photo
 * this browser no longer holds must show no crop rather than another
 * document's pixels.
 */
export type DocumentImages = Readonly<Record<string, DocumentImage>>
