import type { Provenance as ProvenanceValue } from '@/domain/application/state'
import { QUIET_THRESHOLD } from '@/domain/ocr/confidence'
import type { ImageSize } from '@/domain/ocr/geometry'
import { COLOR } from '@/ui/theme/tokens'
import { DocumentCrop } from './DocumentCrop'

/**
 * A carried value is a guess, not a fact — a dealer licence may be registered
 * somewhere other than home — so the copy invites a check rather than reading
 * like settled data.
 */
const SOURCE_LABEL: Record<string, string> = {
  ocr: 'from your document',
  carried: 'copied from what you already told us — check it belongs here',
  lookup: 'looked up for you',
  user: 'entered by you',
}

type Props = {
  provenance: ProvenanceValue
  /** The uploaded document, if the browser still holds it — absent after a reload. */
  imageUrl?: string
  imageSize?: ImageSize
}

export function Provenance({ provenance, imageUrl, imageSize }: Props) {
  const unsure =
    provenance.source === 'ocr'
    && provenance.confidence !== undefined
    && provenance.confidence < QUIET_THRESHOLD

  const label = SOURCE_LABEL[provenance.source] ?? provenance.source
  // Never a number and never a code: a person reads this, not a log parser.
  const text = unsure ? `${label} — the photo was hard to read here` : label

  return (
    <>
      {provenance.box && (
        <DocumentCrop
          imageUrl={imageUrl}
          box={provenance.box}
          imageSize={imageSize}
          alt="The part of your document this was read from"
        />
      )}
      <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '4px 0 0' }}>
        {text}
      </p>
    </>
  )
}
