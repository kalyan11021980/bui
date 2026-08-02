import { COLOR } from '@/ui/theme/tokens'

type Props = {
  done: number
  total: number
  onSubmit?: () => void
}

/**
 * The primary button is NEVER disabled (spec §9). A greyed-out button reads
 * as broken; naming what is outstanding reads as a next step.
 */
export function ProgressSummary({ done, total, onSubmit }: Props) {
  const remaining = total - done
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '12px 14px', borderTop: `1px solid ${COLOR.divider}`,
      }}
    >
      <div>
        <div style={{ fontSize: 14, color: COLOR.textPrimary }}>
          {done} of {total} done
        </div>
        {remaining > 0 && (
          <div style={{ fontSize: 13, color: COLOR.textSecondary }}>
            {remaining} left to go
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        style={{
          background: COLOR.primary, color: COLOR.surface, border: 'none',
          padding: '10px 18px', fontSize: 15, cursor: 'pointer',
        }}
      >
        Submit for review
      </button>
    </div>
  )
}
