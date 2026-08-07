import type { FieldState } from '@/domain/application/state'
import { fieldDef } from '@/domain/catalog'
import { parseReqKey, type RequirementKey } from '@/domain/requirements/key'
import { COLOR, STATUS_COLOR } from '@/ui/theme/tokens'
import { CarryAck } from './CarryAck'
import { fieldInputId } from './FieldControl'
import { FieldInput } from './FieldInput'
import { formatValue } from './format'
import { displayLabel } from './label'
import { Provenance } from './Provenance'
import { Rationale } from './Rationale'
import { RejectionBanner } from './RejectionBanner'

/**
 * A pair, at compile time: a row that can record a value and cannot unrecord
 * it is how the stored record drifts away from what is on screen.
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
   * What the last edit to THIS row carried into, and emptied. Shown at the
   * point of typing because the destinations are usually below the fold.
   */
  carriedInto?: readonly RequirementKey[]
  carriedOut?: readonly RequirementKey[]
}

export function FieldRow(props: Props) {
  // `onChange` and `onClear` stay on `props`: destructuring a union loses the
  // correlation between them, which is what the type is here to enforce.
  const {
    fieldId, state, onConfirm, onEdit, carriedInto, carriedOut,
  } = props
  const onChange = props.onChange
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
        // Texture, not a hue: dashed means "we read this, you have not
        // confirmed it".
        borderLeft: `3px ${isDerived ? 'dashed' : 'solid'} ${STATUS_COLOR[status]}`,
        borderTop: `1px solid ${COLOR.divider}`,
        borderRight: `1px solid ${COLOR.divider}`,
        borderBottom: `1px solid ${COLOR.divider}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        {/* Uppercased in CSS rather than JS, so the accessible name stays
            "License number 1" and not "LICENSE NUMBER 1". */}
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

      {/* When editable, the input already carries the value. A file input is
          the exception — the browser will not show what is already selected. */}
      {state?.value != null && (!onChange || def.type === 'file') && (
        <div style={{ fontSize: 15, color: COLOR.textPrimary, margin: '4px 0' }}>
          {formatValue(state.value, def.type)}
        </div>
      )}

      {/* Checked at runtime as well as in the type: a cast that got one past
          the compiler would leave a row that records and cannot unrecord. */}
      {props.onChange !== undefined && props.onClear !== undefined && (
        <FieldInput
          fieldId={fieldId}
          def={def}
          state={state}
          onChange={props.onChange}
          onClear={props.onClear}
        />
      )}

      {/* Same eyeline as the caret that caused it. */}
      <CarryAck filled={carriedInto ?? []} cleared={carriedOut ?? []} />

      <Rationale field={def} id={rationaleId} />

      {state?.provenance && (
        <Provenance provenance={state.provenance} />
      )}

      {state?.rejection && <RejectionBanner reason={state.rejection.reason} />}

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
