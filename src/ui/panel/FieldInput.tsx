'use client'

import { useRef, useState } from 'react'
import { ZodEnum } from 'zod'
import type { FieldState } from '@/domain/application/state'
import type { FieldDef } from '@/domain/field-def'
import type { RequirementKey } from '@/domain/requirements/key'
import { COLOR } from '@/ui/theme/tokens'

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
}

/**
 * Derived from the full RequirementKey, so two licences get two separately
 * labelled "License number" inputs. `#` is replaced because it is legal in an
 * HTML id but must be escaped in every CSS selector that touches it.
 */
export function fieldInputId(fieldId: RequirementKey): string {
  return `field-${fieldId.replace('#', '--')}`
}

function errorId(fieldId: RequirementKey): string {
  return `${fieldInputId(fieldId)}-error`
}

function inputTypeFor(type: FieldDef['type']): string {
  switch (type) {
    case 'date': return 'date'
    case 'phone': return 'tel'
    case 'file': return 'file'
    // `taxid` is deliberately NOT type="password": hiding what you typed from
    // yourself is how a mistyped SSN gets submitted.
    case 'text': case 'taxid': case 'address': case 'select': default: return 'text'
  }
}

function optionsFor(def: FieldDef): readonly string[] | null {
  return def.validation instanceof ZodEnum ? def.validation.options : null
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
export function FieldInput({ fieldId, def, state, onChange, onClear }: Props) {
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

  const options = optionsFor(def)
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

  const shared = {
    id: fieldInputId(fieldId),
    name: fieldId,
    'aria-invalid': error !== null,
    ...(error !== null && { 'aria-describedby': errorId(fieldId) }),
    style: {
      width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
      fontSize: 15, color: COLOR.textPrimary, background: COLOR.surface,
      // Warning orange, never the brand red: red means "IAA", not "wrong".
      border: `1px solid ${error !== null ? COLOR.error : COLOR.border}`,
    },
  }

  return (
    <div style={{ margin: '6px 0' }}>
      {isFile ? (
        <input
          {...shared}
          type="file"
          multiple
          onChange={(e) => {
            // TODO(phase-2): real upload and a document id. Only file NAMES
            // are stored for now; the array-of-strings shape is chosen so the
            // swap does not change the state model.
            const names = [...(e.target.files ?? [])].map((f) => f.name)
            if (names.length > 0) onChange(fieldId, names)
          }}
        />
      ) : options ? (
        <select {...shared} value={draft} onChange={(e) => report(e.target.value)}>
          <option value="">Choose one</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          type={inputTypeFor(def.type)}
          value={draft}
          onChange={(e) => report(e.target.value)}
        />
      )}

      {error && (
        <p
          id={errorId(fieldId)}
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
