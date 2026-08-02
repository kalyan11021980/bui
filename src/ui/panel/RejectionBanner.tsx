import { COLOR } from '@/ui/theme/tokens'

/** Orange, not the brand red — red means "IAA", not "you got it wrong". */
export function RejectionBanner({ reason }: { reason: string }) {
  return (
    <p
      style={{
        fontSize: 13, margin: '6px 0 0', padding: '6px 8px',
        background: COLOR.errorSurface, color: COLOR.textPrimary,
      }}
    >
      {reason}
    </p>
  )
}
