import type { Provenance as ProvenanceValue } from '@/domain/application/state'
import { COLOR } from '@/ui/theme/tokens'

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

export function Provenance({ provenance }: { provenance: ProvenanceValue }) {
  return (
    <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '4px 0 0' }}>
      {SOURCE_LABEL[provenance.source] ?? provenance.source}
    </p>
  )
}
