import type { FieldId } from '../field-id'
import type { ApplicantProfile, LicenseType } from '../requirements/rules'

/**
 * One fact, two homes: each determinant lives as a catalog field the panel
 * can ask and as the ApplicantProfile key the engine reads. The reducer uses
 * this table to keep them agreeing in both directions.
 */
export type BridgeEntry = {
  fieldId: FieldId
  key: keyof ApplicantProfile
  /** Field value (already schema-validated) → profile patch. */
  toPatch(value: unknown): Partial<ApplicantProfile>
  /** Patched profile value → field value; null means nothing to record. */
  toFieldValue(value: ApplicantProfile[keyof ApplicantProfile]): unknown
}

const yesNo = (value: ApplicantProfile[keyof ApplicantProfile]) =>
  value === true ? 'yes' : 'no'

export const PROFILE_BRIDGE: readonly BridgeEntry[] = [
  {
    fieldId: 'applicant_type', key: 'applicantType',
    toPatch: (v) => ({ applicantType: v as ApplicantProfile['applicantType'] }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'location_country', key: 'country',
    toPatch: (v) => ({ country: v as string }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'location_state', key: 'state',
    toPatch: (v) => ({ state: v as string }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'id_form', key: 'idForm',
    toPatch: (v) => ({ idForm: v as ApplicantProfile['idForm'] }),
    toFieldValue: (v) => v,
  },
  {
    fieldId: 'address_differs', key: 'addressDiffersFromId',
    toPatch: (v) => ({ addressDiffersFromId: v === 'yes' }),
    toFieldValue: yesNo,
  },
  {
    fieldId: 'wants_gsa', key: 'wantsGsa',
    toPatch: (v) => ({ wantsGsa: v === 'yes' }),
    toFieldValue: yesNo,
  },
  {
    fieldId: 'licenses_held', key: 'licenses',
    toPatch: (v) => ({ licenses: v as LicenseType[] }),
    toFieldValue: (v) => (Array.isArray(v) && v.length > 0 ? v : null),
  },
  {
    fieldId: 'biz_country', key: 'bizCountry',
    toPatch: (v) => ({ bizCountry: v as string }),
    toFieldValue: (v) => v,
  },
]

const BY_FIELD: ReadonlyMap<FieldId, BridgeEntry> = new Map(
  PROFILE_BRIDGE.map((e) => [e.fieldId, e]),
)

export function bridgeForField(fieldId: FieldId): BridgeEntry | undefined {
  return BY_FIELD.get(fieldId)
}
