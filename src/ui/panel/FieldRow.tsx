import type { FieldState } from '@/domain/application/state'
import { fieldDef } from '@/domain/catalog'
import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'
import { COLOR, STATUS_COLOR } from '@/ui/theme/tokens'
import { Rationale } from './Rationale'

type Props = {
  /** A RequirementKey: a plain FieldId, or `license_number#0` for licences. */
  fieldId: RequirementKey
  state: FieldState | undefined
  onConfirm?: (id: RequirementKey) => void
  onEdit?: (id: RequirementKey) => void
}

/**
 * A carried value is a guess, not a fact: a sole trader's business address is
 * usually their home address, but a dealer licence may be registered elsewhere.
 * The copy must invite a check rather than read like settled data, because a
 * plausible pre-filled value is exactly what gets rubber-stamped. Spec §10.4.
 */
const SOURCE_LABEL: Record<string, string> = {
  ocr: 'from your document',
  carried: 'copied from what you already told us — check it belongs here',
  lookup: 'looked up for you',
  user: 'entered by you',
}

export function FieldRow({ fieldId, state, onConfirm, onEdit }: Props) {
  // A key may carry an instance suffix; the catalog is keyed by bare FieldId.
  const def = fieldDef(parseReqKey(fieldId).fieldId)
  const status = state?.status ?? 'empty'
  const isDerived = status === 'derived'
  const rationaleId = `rationale-${fieldId}`

  return (
    <div
      role="group"
      aria-label={def.label}
      aria-describedby={rationaleId}
      style={{
        padding: '12px 14px',
        marginBottom: 8,
        background: COLOR.surface,
        // Texture, not a new hue: dashed means "we read this, you have not
        // confirmed it". Spec §9.
        borderLeft: `3px ${isDerived ? 'dashed' : 'solid'} ${STATUS_COLOR[status]}`,
        borderTop: `1px solid ${COLOR.divider}`,
        borderRight: `1px solid ${COLOR.divider}`,
        borderBottom: `1px solid ${COLOR.divider}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: 12, letterSpacing: '.04em', color: COLOR.textPrimary }}>
          {def.label.toUpperCase()}
        </strong>
        {(status === 'confirmed' || status === 'verified') && (
          <span aria-label="confirmed" style={{ color: COLOR.success }}>✓</span>
        )}
      </div>

      {state?.value != null && (
        <div style={{ fontSize: 15, color: COLOR.textPrimary, margin: '4px 0' }}>
          {String(state.value)}
        </div>
      )}

      <Rationale field={def} id={rationaleId} />

      {state?.provenance && (
        <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '4px 0 0' }}>
          {SOURCE_LABEL[state.provenance.source] ?? state.provenance.source}
        </p>
      )}

      {state?.rejection && (
        <p
          style={{
            fontSize: 13, margin: '6px 0 0', padding: '6px 8px',
            background: COLOR.errorSurface, color: COLOR.textPrimary,
          }}
        >
          {state.rejection.reason}
        </p>
      )}

      {isDerived && onConfirm && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => onConfirm(fieldId)}
            style={{
              background: COLOR.primary, color: COLOR.surface,
              border: 'none', padding: '6px 12px', cursor: 'pointer',
            }}
          >
            Looks right
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(fieldId)}
              style={{
                background: COLOR.surface, color: COLOR.primary,
                border: `1px solid ${COLOR.primary}`, padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              Fix this
            </button>
          )}
        </div>
      )}
    </div>
  )
}
