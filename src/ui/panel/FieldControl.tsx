'use client'

import { ZodEnum } from 'zod'
import type { FieldDef } from '@/domain/field-def'
import type { RequirementKey } from '@/domain/requirements/key'
import { COLOR } from '@/ui/theme/tokens'

/**
 * Derived from the full RequirementKey, so two licences get two separately
 * labelled "License number" inputs. `#` is replaced because it is legal in an
 * HTML id but must be escaped in every CSS selector that touches it.
 */
export function fieldInputId(fieldId: RequirementKey): string {
  return `field-${fieldId.replace('#', '--')}`
}

export function fieldErrorId(fieldId: RequirementKey): string {
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

type Props = {
  fieldId: RequirementKey
  def: FieldDef
  /** What the box shows. Not the recorded value — see FieldInput. */
  draft: string
  error: string | null
  onText: (next: string) => void
  onFiles: (names: string[]) => void
}

/** The element itself. Validation and draft state live in FieldInput. */
export function FieldControl({ fieldId, def, draft, error, onText, onFiles }: Props) {
  const options = optionsFor(def)

  const shared = {
    id: fieldInputId(fieldId),
    name: fieldId,
    'aria-invalid': error !== null,
    ...(error !== null && { 'aria-describedby': fieldErrorId(fieldId) }),
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
    return (
      <select {...shared} value={draft} onChange={(e) => onText(e.target.value)}>
        <option value="">Choose one</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      {...shared}
      type={inputTypeFor(def.type)}
      value={draft}
      onChange={(e) => onText(e.target.value)}
    />
  )
}
