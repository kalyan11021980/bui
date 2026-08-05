import type { ZodType } from 'zod'
import type { Authority } from './authority'
import type { DocType, FieldId } from './field-id'
import type { Section } from './section'

export type FieldType =
  | 'text' | 'date' | 'select' | 'phone' | 'address' | 'file' | 'taxid'

/**
 * One choice in a `select`. Kept separate from the Zod enum because what is
 * stored and what is read are not the same string: a state is stored as "CA"
 * (the DMV's code, and what `validation` accepts) and shown as "California".
 */
export type FieldOption = {
  value: string
  label: string
}

type FieldDefBase<T> = {
  id: FieldId
  label: string
  type: FieldType
  /**
   * The choices, when there are any. A `select` without this renders as a
   * plain text box — so the absence of a confirmed option list shows up as
   * an honest text field rather than a dropdown that looks broken.
   */
  options?: readonly FieldOption[]
  /**
   * A sample answer, shown as placeholder text. Never a real value, and
   * never something that could be mistaken for one already entered.
   */
  example?: string
  /** What this is FOR, in the user's terms. Required. */
  purpose: string
  /** WHO requires it. Required. */
  authority: Authority
  section: Section
  /** Vetted, legally reviewed. Never model-generated. */
  consequence?: string
  /** Privacy answer, shown by default on sensitive fields. */
  handling?: string
  /** Where the value lands, e.g. "W-9, line 1". */
  destination?: string
  validation: ZodType<T>
  derivableFrom?: readonly DocType[]
  /**
   * Address, legal name and taxpayer ID: no bulk-confirm affordance exists
   * yet, so this constrains nothing today. It is a guard placed ahead of
   * the thing it guards — when a bulk affordance is built, it cannot
   * include a field marked here.
   */
  neverBulkConfirm?: boolean
}

/**
 * `sensitive` and `orchestratorVisible` are mutually exclusive: a value the
 * orchestrator may see is by definition not sensitive.
 *
 * The sensitive branch types `orchestratorVisible` as `?: never` rather than
 * omitting it, so the guarantee survives indirect construction — omitting it
 * would only trip the excess-property check, which fires for fresh object
 * literals alone. Consequence: TypeScript anchors the error to the
 * `defineField(` call, so `@ts-expect-error` must sit above the call, not
 * above the property.
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
  // Read through a cast: checking `def.orchestratorVisible` directly would
  // narrow `def` to `never` (the union says the combination is impossible)
  // and break the `def.id` access below. The runtime check still has to exist
  // for objects built indirectly.
  const orchestratorVisible = (def as { orchestratorVisible?: boolean }).orchestratorVisible
  if (def.sensitive === true && orchestratorVisible === true) {
    throw new Error(
      `Field "${def.id}": sensitive fields cannot set orchestratorVisible`,
    )
  }
  return def
}
