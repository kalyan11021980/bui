'use client'

import { ZodEnum } from 'zod'
import type { FieldDef, FieldOption } from '@/domain/field-def'
import type { RequirementKey } from '@/domain/requirements/key'
import { COLOR } from '@/ui/theme/tokens'

/**
 * Derived from the full RequirementKey, so two licences get two separately
 * labelled "License number" inputs. `#` is replaced because it is legal in an
 * HTML id but must be escaped in every CSS selector that touches it.
 */
/**
 * `scope` namespaces the id for a second renderer of the same field — the
 * chat surface renders a `field_ask` for a field the panel is already
 * showing a row for (the guard only permits an ask for an outstanding
 * field, so the panel's row for it always exists too). Two elements sharing
 * one id is invalid HTML and `<label for>` resolves to whichever is first in
 * document order, mislabelling the other — omitted, this returns exactly
 * what it always has.
 */
export function fieldInputId(fieldId: RequirementKey, scope?: string): string {
  const base = `field-${fieldId.replace('#', '--')}`
  return scope ? `${scope}-${base}` : base
}

export function fieldErrorId(fieldId: RequirementKey, scope?: string): string {
  return `${fieldInputId(fieldId, scope)}-error`
}

export function fieldHintId(fieldId: RequirementKey, scope?: string): string {
  return `${fieldInputId(fieldId, scope)}-hint`
}

function inputTypeFor(type: FieldDef['type']): string {
  switch (type) {
    case 'date': return 'date'
    case 'phone': return 'tel'
    case 'file': return 'file'
    // `taxid` is deliberately NOT type="password": hiding what you typed from
    // yourself is how a mistyped SSN gets submitted.
    case 'attest': case 'multiselect':
    case 'text': case 'taxid': case 'address': case 'select': default: return 'text'
  }
}

/**
 * The catalog's own option list wins: it carries a display label ("California")
 * distinct from the stored code ("CA"). The Zod enum is the fallback for a
 * field whose stored value is already the thing to show.
 */
function optionsFor(def: FieldDef): readonly FieldOption[] | null {
  if (def.options) return def.options
  if (def.validation instanceof ZodEnum) {
    return def.validation.options.map((o: string) => ({ value: o, label: o }))
  }
  return null
}

type Props = {
  fieldId: RequirementKey
  def: FieldDef
  /** What the box shows. Not the recorded value — see FieldInput. */
  draft: string
  error: string | null
  onText: (next: string) => void
  onFiles: (names: string[]) => void
  /** See `fieldInputId` — set when this is not the panel's own copy of the field. */
  scope?: string
}

/** The element itself. Validation and draft state live in FieldInput. */
export function FieldControl({ fieldId, def, draft, error, onText, onFiles, scope }: Props) {
  const options = optionsFor(def)
  const describedBy = error !== null ? fieldErrorId(fieldId, scope) : ''

  const shared = {
    id: fieldInputId(fieldId, scope),
    name: fieldId,
    'aria-invalid': error !== null,
    ...(describedBy !== '' && { 'aria-describedby': describedBy }),
    style: {
      width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px',
      fontSize: 15, color: COLOR.textPrimary, background: COLOR.surface,
      // Warning orange, never the brand red: red means "IAA", not "wrong".
      border: `1px solid ${error !== null ? COLOR.error : COLOR.border}`,
    },
  }

  if (def.type === 'file') {
    return (
      <input
        {...shared}
        type="file"
        multiple
        onChange={(e) => onFiles([...(e.target.files ?? [])].map((f) => f.name))}
      />
    )
  }

  if (options) {
    // A question-shaped label ("Which ID will you use?") reads as nonsense
    // lowercased into the "Select …" template — swap in a neutral prompt.
    const placeholder = def.label.endsWith('?')
      ? 'Choose an answer…'
      : `Select ${def.label.toLowerCase()}…`
    return (
      <select {...shared} value={draft} onChange={(e) => onText(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      {...shared}
      type={inputTypeFor(def.type)}
      value={draft}
      {...(def.example && { placeholder: def.example })}
      onChange={(e) => onText(e.target.value)}
    />
  )
}
