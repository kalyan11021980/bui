import type { FieldDef } from '../field-def'
import type { DocType, FieldId } from '../field-id'
import { PREFERENCE_FIELDS } from './preferences'
import { IDENTITY_FIELDS } from './identity'
import { ADDRESS_FIELDS } from './address'
import { CONTACT_FIELDS } from './contact'
import { BUSINESS_FIELDS } from './business'
import { LICENSE_FIELDS } from './license'
import { TAX_FIELDS } from './tax'
import { GSA_FIELDS } from './gsa'
import { STATE_FORM_FIELDS } from './state-forms'

export const ALL_FIELDS: readonly FieldDef[] = [
  ...PREFERENCE_FIELDS,
  ...IDENTITY_FIELDS,
  ...ADDRESS_FIELDS,
  ...CONTACT_FIELDS,
  ...BUSINESS_FIELDS,
  ...LICENSE_FIELDS,
  ...TAX_FIELDS,
  ...GSA_FIELDS,
  ...STATE_FORM_FIELDS,
]

export const CATALOG: ReadonlyMap<FieldId, FieldDef> = new Map(
  ALL_FIELDS.map((f) => [f.id, f]),
)

export function fieldDef(id: FieldId): FieldDef {
  const def = CATALOG.get(id)
  if (!def) throw new Error(`Unknown field: ${String(id)}`)
  return def
}

/**
 * Whether photographing this document stands in for a sensitive field — e.g.
 * a driver's license backs `dl_number`. Voice suppression treats a
 * `document_request` the same as the `field_ask` it substitutes for.
 */
export function docTypeBacksSensitiveField(docType: DocType): boolean {
  return ALL_FIELDS.some((f) => f.sensitive === true && f.derivableFrom?.includes(docType))
}

export {
  PREFERENCE_FIELDS,
  IDENTITY_FIELDS, ADDRESS_FIELDS, CONTACT_FIELDS,
  BUSINESS_FIELDS, LICENSE_FIELDS, TAX_FIELDS, GSA_FIELDS,
  STATE_FORM_FIELDS,
}
