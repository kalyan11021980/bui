import type { FieldState } from '@/domain/application/state'
import { fieldDef } from '@/domain/catalog'
import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'
import { COLOR, STATUS_COLOR } from '@/ui/theme/tokens'
import { CarryAck } from './CarryAck'
import { FieldInput, fieldInputId } from './FieldInput'
import { formatValue } from './format'
import { displayLabel } from './label'
import { Rationale } from './Rationale'

/**
 * Supplying these makes the field editable (spec §15 / §11.1) — and they come
 * as a PAIR, at compile time.
 *
 * A row that can record a value and cannot unrecord it is exactly how the
 * stored record drifts away from what is on screen (F3), so `onChange`
 * without `onClear` is not a thing this component will render. The union
 * makes forgetting one a type error rather than a silent divergence.
 */
type EditHandlers =
  | {
      onChange: (id: RequirementKey, value: unknown) => void
      onClear: (id: RequirementKey) => void
    }
  | { onChange?: undefined; onClear?: undefined }

type Props = EditHandlers & {
  /** A RequirementKey: a plain FieldId, or `license_number#0` for licences. */
  fieldId: RequirementKey
  state: FieldState | undefined
  onConfirm?: (id: RequirementKey) => void
  onEdit?: (id: RequirementKey) => void
  /**
   * Fields the applicant's last edit to THIS row carried a value into, and
   * fields it emptied because this edit took away what they mirrored. Shown
   * here, at the point of typing, because the destinations are in other
   * sections and often below the fold.
   */
  carriedInto?: readonly RequirementKey[]
  carriedOut?: readonly RequirementKey[]
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

export function FieldRow(props: Props) {
  // `onChange` and `onClear` stay on `props` rather than being destructured:
  // destructuring a union loses the correlation between them, and it is that
  // correlation the type is here to enforce.
  const {
    fieldId, state, onConfirm, onEdit, carriedInto, carriedOut,
  } = props
  const onChange = props.onChange
  // A key may carry an instance suffix; the catalog is keyed by bare FieldId.
  const { fieldId: bareId } = parseReqKey(fieldId)
  const def = fieldDef(bareId)
  const label = displayLabel(fieldId)
  const status = state?.status ?? 'empty'
  const isDerived = status === 'derived'
  const rationaleId = `rationale-${fieldId}`

  return (
    <div
      role="group"
      aria-label={label}
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
        {/* A real <label> pointing at the input, not decorative bold text —
            otherwise the control a user must fill in has no accessible name.
            Uppercasing is done in CSS rather than in JS so the accessible
            name stays "License number 1" and not "LICENSE NUMBER 1". */}
        <label
          htmlFor={fieldInputId(fieldId)}
          style={{
            fontSize: 12, letterSpacing: '.04em', fontWeight: 700,
            textTransform: 'uppercase', color: COLOR.textPrimary,
          }}
        >
          {label}
        </label>
        {(status === 'confirmed' || status === 'verified') && (
          <span aria-label="confirmed" style={{ color: COLOR.success }}>✓</span>
        )}
      </div>

      {/* When the field is editable the input carries the value, so repeating
          it above would be two sources of truth on one row. A file input is
          the exception: the browser will not let us show what is already
          selected, so the stored names are printed. */}
      {state?.value != null && (!onChange || def.type === 'file') && (
        <div style={{ fontSize: 15, color: COLOR.textPrimary, margin: '4px 0' }}>
          {formatValue(state.value, def.type)}
        </div>
      )}

      {/* Both, at runtime as well as in the type. A cast that got one past
          the compiler would otherwise produce a field that records values and
          throws when asked to unrecord one, mid-keystroke, on a KYC form. */}
      {props.onChange !== undefined && props.onClear !== undefined && (
        <FieldInput
          fieldId={fieldId}
          def={def}
          state={state}
          onChange={props.onChange}
          onClear={props.onClear}
        />
      )}

      {/* Directly under the control, above the rationale: the acknowledgement
          has to be inside the same eyeline as the caret that caused it. */}
      <CarryAck filled={carriedInto ?? []} cleared={carriedOut ?? []} />

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
