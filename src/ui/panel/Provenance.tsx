import type { Provenance as ProvenanceValue } from '@/domain/application/state'
import { QUIET_THRESHOLD } from '@/domain/ocr/confidence'
import { COLOR } from '@/ui/theme/tokens'
import { DocumentCrop } from './DocumentCrop'
import type { DocumentImages } from './document-images'

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
  /** The uploaded documents, if the browser still holds them — empty after a reload. */
  documents?: DocumentImages
}

export function Provenance({ provenance, documents }: Props) {
  // The document this value was read from, and never another. A crop drawn
  // from a later upload would show a region of a document the value did not
  // come from, under a label saying it did. No match means no crop: the
  // sentence and the confidence stand on their own.
  const image = provenance.documentId
    ? documents?.[provenance.documentId]
    : undefined

  const unsure =
    provenance.source === 'ocr'
    && provenance.confidence !== undefined
    && provenance.confidence < QUIET_THRESHOLD

  const label = SOURCE_LABEL[provenance.source] ?? provenance.source
  // Never a number and never a code: a person reads this, not a log parser.
  const text = unsure ? `${label} — the photo was hard to read here` : label

  return (
    <>
      {provenance.box && image && (
        <DocumentCrop
          imageUrl={image.url}
          box={provenance.box}
          imageSize={image.size}
          alt="The part of your document this was read from"
        />
      )}
      <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '4px 0 0' }}>
        {text}
      </p>
    </>
  )
}
