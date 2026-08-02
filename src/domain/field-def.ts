import type { ZodType } from 'zod'
import type { Authority } from './authority'
import type { DocType, FieldId } from './field-id'

export type FieldType =
  | 'text' | 'date' | 'select' | 'phone' | 'address' | 'file' | 'taxid'

type FieldDefBase<T> = {
  id: FieldId
  label: string
  type: FieldType
  /** What this is FOR, in the user's terms. Required. */
  purpose: string
  /** WHO requires it. Required. */
  authority: Authority
  /** Vetted, legally reviewed. Never model-generated. */
  consequence?: string
  /** Privacy answer, shown by default on sensitive fields. */
  handling?: string
  /** Where the value lands, e.g. "W-9, line 1". */
  destination?: string
  validation: ZodType<T>
  derivableFrom?: readonly DocType[]
}

/**
 * `sensitive` and `orchestratorVisible` are mutually exclusive (spec §8.1):
 * a value the orchestrator may see is by definition not sensitive.
 *
 * The `sensitive: true` branch intentionally omits `orchestratorVisible`
 * (rather than typing it `?: never`) so that setting it on a sensitive
 * field triggers TypeScript's excess-property check. That check anchors
 * the diagnostic to the offending property's own source line instead of
 * the enclosing call expression, which is what lets a `@ts-expect-error`
 * placed directly above `orchestratorVisible: true` in a test suppress
 * exactly that error. A `never`-typed property here would still fail to
 * compile, but the diagnostic would be reported at the call site instead.
 */
export type FieldDef<T = unknown> =
  | (FieldDefBase<T> & { sensitive: true })
  | (FieldDefBase<T> & { sensitive?: false; orchestratorVisible?: boolean })

export function defineField<T>(def: FieldDef<T>): FieldDef<T> {
  if (def.purpose.trim() === '') {
    throw new Error(`Field "${def.id}": purpose must not be empty`)
  }
  if (def.label.trim() === '') {
    throw new Error(`Field "${def.id}": label must not be empty`)
  }
  if (def.sensitive === true && 'orchestratorVisible' in def &&
      (def as { orchestratorVisible?: boolean }).orchestratorVisible === true) {
    throw new Error(
      `Field "${def.id}": sensitive fields cannot set orchestratorVisible`,
    )
  }
  return def
}
