'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { COLOR } from '@/ui/theme/tokens'
import { displayLabel } from './label'
import { revealField } from './reveal'

type Props = {
  /** What carry just filled in as a result of the edit on THIS row. */
  filled: readonly RequirementKey[]
  /** What carry just emptied, because this edit removed what they mirrored. */
  cleared: readonly RequirementKey[]
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
 *
 * Clearing is reported the same way and just as plainly. A field emptying
 * itself somewhere the applicant cannot see is the same invisibility problem
 * as one filling itself in, and this one costs them work rather than saving
 * it — so it is said out loud rather than done quietly.
 */
export function CarryAck({ filled, cleared }: Props) {
  if (filled.length === 0 && cleared.length === 0) return null

  return (
    // A polite live region, so the change is announced rather than only seen.
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
