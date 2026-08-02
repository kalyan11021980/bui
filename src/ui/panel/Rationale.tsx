import { AUTHORITY_LABEL } from '@/domain/authority'
import type { FieldDef } from '@/domain/field-def'
import { COLOR } from '@/ui/theme/tokens'

/** Catalog strings, rendered verbatim — never generated or paraphrased. */
export function Rationale({ field, id }: { field: FieldDef; id?: string }) {
  return (
    <div id={id} style={{ fontSize: 13, color: COLOR.textSecondary }}>
      <p style={{ margin: '2px 0' }}>{field.purpose}</p>
      <p style={{ margin: '2px 0', color: COLOR.textMuted }}>
        Required by {AUTHORITY_LABEL[field.authority]}
        {field.destination ? ` · goes on ${field.destination}` : ''}
      </p>
      {field.consequence && (
        <p style={{ margin: '2px 0' }}>{field.consequence}</p>
      )}
      {/* Answered up front, never on hover — that is where people abandon. */}
      {field.sensitive && field.handling && (
        <p style={{ margin: '2px 0', color: COLOR.textSecondary }}>
          {field.handling}
        </p>
      )}
    </div>
  )
}
