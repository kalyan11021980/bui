'use client'

import { useState } from 'react'
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
}

/**
 * The id the visible label points at. Derived from the FULL RequirementKey,
 * so a business holding two licences gets two distinct, separately-labelled
 * "License number" inputs rather than one label pointing at both.
 *
 * `#` is legal in an HTML id but has to be escaped in every CSS selector that
 * touches it, which is a papercut waiting to be forgotten; `--` encodes the
 * same information and appears in no FieldId.
 */
export function fieldInputId(fieldId: RequirementKey): string {
  return `field-${fieldId.replace('#', '--')}`
}

function errorId(fieldId: RequirementKey): string {
  return `${fieldInputId(fieldId)}-error`
}

/** The HTML input type that suits this field. */
function inputTypeFor(type: FieldDef['type']): string {
  switch (type) {
    case 'date': return 'date'
    case 'phone': return 'tel'
    case 'file': return 'file'
    // `taxid` is deliberately NOT type="password": hiding what you typed from
    // yourself is how a mistyped SSN gets submitted. Confidentiality is
    // handled at rest and in the audit log, not by blanking the glyphs.
    case 'text': case 'taxid': case 'address': case 'select': default: return 'text'
  }
}

/** The fixed choices for this field, when its schema is an enum. */
function optionsFor(def: FieldDef): readonly string[] | null {
  return def.validation instanceof ZodEnum ? def.validation.options : null
}

/** Turns a stored value back into something an input element can show. */
function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/**
 * The data-entry control for one field. Split out of FieldRow, which already
 * carries key parsing, instance disambiguation, status styling, value
 * rendering, rationale, provenance, rejection and buttons.
 *
 * It reports a value upward only once the field's OWN catalog schema accepts
 * it — the same schema the route enforces (§8.2). Anything else would send
 * every keystroke of a phone number to a handler that must reject nine of
 * them. What the user has typed so far still stays on screen; only the
 * dispatch waits.
 */
export function FieldInput({ fieldId, def, state, onChange }: Props) {
  const external = toInputValue(state?.value)
  const [draft, setDraft] = useState(external)
  const [lastExternal, setLastExternal] = useState(external)

  // Adjusting state during render, rather than in an effect: when a value is
  // carried in from another field (§9) the input must show it immediately,
  // not one paint later. React's documented pattern for deriving state from
  // props.
  if (external !== lastExternal) {
    setLastExternal(external)
    setDraft(external)
  }

  const options = optionsFor(def)
  const isFile = def.type === 'file'

  const result = def.validation.safeParse(isFile ? state?.value ?? [] : draft)
  // An untouched field is outstanding, not wrong. Shouting at someone for not
  // having typed anything yet is how a form reads as hostile.
  const error = draft !== '' && !result.success
    ? result.error.issues[0]?.message ?? 'Check this value'
    : null

  function report(next: string) {
    setDraft(next)
    const parsed = def.validation.safeParse(next)
    if (parsed.success) onChange(fieldId, next)
  }

  const shared = {
    id: fieldInputId(fieldId),
    name: fieldId,
    'aria-invalid': error !== null,
    ...(error !== null && { 'aria-describedby': errorId(fieldId) }),
    style: {
      width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
      fontSize: 15, color: COLOR.textPrimary, background: COLOR.surface,
      // The invalid border is the WARNING ORANGE, never the brand red: red is
      // IAA's primary and means "IAA", not "you got it wrong".
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
            // Phase 1 has no upload service, so only the FILE NAMES are
            // stored — enough to satisfy the catalog schema and show the user
            // what they picked. Phase 2 replaces this with a real upload and
            // a document id; the value shape (an array of strings) is chosen
            // so that swap does not change the state model.
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
