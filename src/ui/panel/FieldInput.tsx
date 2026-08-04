'use client'

import { useRef, useState } from 'react'
import type { FieldState } from '@/domain/application/state'
import type { FieldDef } from '@/domain/field-def'
import type { RequirementKey } from '@/domain/requirements/key'
import { COLOR } from '@/ui/theme/tokens'
import { FieldControl, fieldErrorId } from './FieldControl'

type Props = {
  /** The full RequirementKey — `license_number#0`, not `license_number`. */
  fieldId: RequirementKey
  def: FieldDef
  state: FieldState | undefined
  onChange: (id: RequirementKey, value: unknown) => void
  /**
   * Required, not optional: a field that can record a value and cannot
   * unrecord it is how the record ends up disagreeing with the screen.
   */
  onClear: (id: RequirementKey) => void
  /** See `fieldInputId` — set when this is not the panel's own copy of the field. */
  scope?: string
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/**
 * Reports a value upward only once the field's own catalog schema accepts it,
 * so a half-typed phone number is not dispatched nine times. What has been
 * typed stays on screen either way; only the dispatch waits.
 *
 * The corollary: when the draft stops being valid the record must not go on
 * holding the last value that was, or the applicant is left attesting to
 * something no longer in front of them, still counted as done.
 */
export function FieldInput({ fieldId, def, state, onChange, onClear, scope }: Props) {
  const external = toInputValue(state?.value)
  const [draft, setDraft] = useState(external)
  const [lastExternal, setLastExternal] = useState(external)
  // The draft that caused us to ask for a clear. The clear echoes back as an
  // empty external value, which must not reset the box they are typing in.
  const clearedFrom = useRef<string | null>(null)

  // Adjusted during render, not in an effect: a carried value must appear
  // immediately, not one paint later.
  if (external !== lastExternal) {
    setLastExternal(external)
    if (!(external === '' && clearedFrom.current === draft)) setDraft(external)
    clearedFrom.current = null
  }

  const isFile = def.type === 'file'
  const result = def.validation.safeParse(isFile ? state?.value ?? [] : draft)
  // An untouched field is outstanding, not wrong.
  const error = draft !== '' && !result.success
    ? result.error.issues[0]?.message ?? 'Check this value'
    : null

  function report(next: string) {
    setDraft(next)

    // An empty box is an answer removed, never a value — some catalog schemas
    // are `.optional()` and would accept "" as a recorded answer.
    if (next !== '' && def.validation.safeParse(next).success) {
      onChange(fieldId, next)
      return
    }

    // Nothing valid on screen, so a stored value now disagrees with what the
    // applicant sees. Only when there is something to drop — typing rubbish
    // into an empty field is not a divergence, and a clear per keystroke
    // would be noise in the trail.
    if (state?.value !== null && state?.value !== undefined) {
      clearedFrom.current = next
      onClear(fieldId)
    }
  }

  return (
    <div style={{ margin: '6px 0' }}>
      <FieldControl
        fieldId={fieldId}
        def={def}
        draft={draft}
        error={error}
        onText={report}
        onFiles={(names) => {
          // TODO(phase-2): real upload and a document id. Only file NAMES are
          // stored for now; the array-of-strings shape is chosen so the swap
          // does not change the state model.
          if (names.length > 0) onChange(fieldId, names)
        }}
        {...(scope !== undefined && { scope })}
      />

      {error && (
        <p
          id={fieldErrorId(fieldId, scope)}
          role="alert"
          style={{
            fontSize: 13, margin: '4px 0 0', padding: '4px 8px',
            background: COLOR.errorSurface, color: COLOR.textPrimary,
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
