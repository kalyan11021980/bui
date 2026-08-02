import type { FieldDef } from '../field-def'
import type { FieldId } from '../field-id'
import { IDENTITY_FIELDS } from './identity'
import { ADDRESS_FIELDS } from './address'
import { CONTACT_FIELDS } from './contact'
import { BUSINESS_FIELDS } from './business'
import { LICENSE_FIELDS } from './license'
import { TAX_FIELDS } from './tax'
import { GSA_FIELDS } from './gsa'

export const ALL_FIELDS: readonly FieldDef[] = [
  ...IDENTITY_FIELDS,
  ...ADDRESS_FIELDS,
  ...CONTACT_FIELDS,
  ...BUSINESS_FIELDS,
  ...LICENSE_FIELDS,
  ...TAX_FIELDS,
  ...GSA_FIELDS,
]

export const CATALOG: ReadonlyMap<FieldId, FieldDef> = new Map(
  ALL_FIELDS.map((f) => [f.id, f]),
)

export function fieldDef(id: FieldId): FieldDef {
  const def = CATALOG.get(id)
  if (!def) throw new Error(`Unknown field: ${String(id)}`)
  return def
}

export {
  IDENTITY_FIELDS, ADDRESS_FIELDS, CONTACT_FIELDS,
  BUSINESS_FIELDS, LICENSE_FIELDS, TAX_FIELDS, GSA_FIELDS,
}
