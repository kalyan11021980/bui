'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { COLOR } from '@/ui/theme/tokens'
import { displayLabel } from './label'
import { revealField } from './reveal'

type Props = {
  /** What carry filled in as a result of the edit on THIS row. */
  filled: readonly RequirementKey[]
  /** What carry emptied, because this edit removed what they mirrored. */
  cleared: readonly RequirementKey[]
}

/**
 * "Also filled in: Business address ↓", anchored to the row just typed into
 * rather than shown as a toast, which has vanished by the time they look up.
 *
 * Styled as the same dashed, unconfirmed texture as the row it points at, and
 * never as a success banner — a carried value is a guess they still check.
 */
export function CarryAck({ filled, cleared }: Props) {
  if (filled.length === 0 && cleared.length === 0) return null

  return (
    <p
      role="status"
      style={{
        fontSize: 13, margin: '8px 0 0', padding: '6px 8px',
        background: COLOR.page,
        borderLeft: `3px dashed ${COLOR.textMuted}`,
        color: COLOR.textSecondary,
      }}
    >
      {filled.length > 0 && <Line lead="Also filled in" fields={filled} />}
      {cleared.length > 0 && <Line lead="Also cleared" fields={cleared} />}
    </p>
  )
}

function Line({ lead, fields }: { lead: string; fields: readonly RequirementKey[] }) {
  return (
    <span style={{ display: 'block' }}>
      {lead}:{' '}
      {fields.map((id, index) => (
        <span key={id}>
          {index > 0 && ', '}
          <button
            type="button"
            aria-label={`Go to ${displayLabel(id)}`}
            onClick={() => revealField(id)}
            style={{
              background: 'none', border: 'none', padding: 0,
              font: 'inherit', color: COLOR.primary,
              textDecoration: 'underline', cursor: 'pointer',
            }}
          >
            {displayLabel(id)} ↓
          </button>
        </span>
      ))}
    </span>
  )
}
