'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { COLOR } from '@/ui/theme/tokens'
import { displayLabel } from './label'
import { revealField } from './reveal'

type Props = {
  /** What carry just filled in as a result of the edit on THIS row. */
  filled: readonly RequirementKey[]
}

/**
 * "Also filled in: Business address ↓"
 *
 * Anchored to the row the applicant just typed into, because that is where
 * their eyes already are. Not a toast: a toast has vanished by the time they
 * look up, and it teaches them nothing about where the value went.
 *
 * The destination name is a button rather than a link, because nothing
 * navigates — it scrolls and focuses. It is styled as the same dashed,
 * unconfirmed texture as the row it points at (§9), so the acknowledgement
 * and its destination read as one thing, and never as a success banner: a
 * carried value is a guess the applicant still has to check (§10.4).
 */
export function CarryAck({ filled }: Props) {
  if (filled.length === 0) return null

  return (
    // A polite live region, so the saving is announced rather than only seen.
    <p
      role="status"
      style={{
        fontSize: 13, margin: '8px 0 0', padding: '6px 8px',
        background: COLOR.page,
        borderLeft: `3px dashed ${COLOR.textMuted}`,
        color: COLOR.textSecondary,
      }}
    >
      Also filled in:{' '}
      {filled.map((id, index) => (
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
    </p>
  )
}
