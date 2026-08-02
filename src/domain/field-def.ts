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
 * The `sensitive: true` branch types `orchestratorVisible` as `?: never`
 * (rather than omitting it) so the guarantee holds for indirect
 * construction too — a variable, a spread, a builder function, a value
 * round-tripped through JSON — not just object literals passed directly
 * to `defineField`. Omitting the key instead would only trip TypeScript's
 * excess-property check, which fires solely for fresh object literals and
 * is silently bypassed by any indirection. The trade-off: with `?: never`,
 * TypeScript anchors the resulting diagnostic to the `defineField(` call
 * expression itself rather than to the specific `orchestratorVisible`
 * property line, so `@ts-expect-error` for this conflict must sit
 * immediately above the call, not above the property.
 */
export type FieldDef<T = unknown> =
  | (FieldDefBase<T> & { sensitive: true; orchestratorVisible?: never })
  | (FieldDefBase<T> & { sensitive?: false; orchestratorVisible?: boolean })

export function defineField<T>(def: FieldDef<T>): FieldDef<T> {
  if (def.purpose.trim() === '') {
    throw new Error(`Field "${def.id}": purpose must not be empty`)
  }
  if (def.label.trim() === '') {
    throw new Error(`Field "${def.id}": label must not be empty`)
  }
  // `orchestratorVisible` is typed `never` in the `sensitive: true` branch of
  // the union, so `def.sensitive === true && def.orchestratorVisible === true`
  // would narrow `def` itself to `never` (TypeScript reasons the combination
  // is statically impossible) and break the `def.id` access below. Reading
  // the value through this cast instead keeps `def` at its narrowed-but-live
  // branch type and keeps the check reachable at runtime for objects built
  // indirectly (variables, spreads, JSON), which the compile-time union
  // cannot see.
  const orchestratorVisible = (def as { orchestratorVisible?: boolean }).orchestratorVisible
  if (def.sensitive === true && orchestratorVisible === true) {
    throw new Error(
      `Field "${def.id}": sensitive fields cannot set orchestratorVisible`,
    )
  }
  return def
}
