import type { FieldId } from '../field-id'

export type LicenseType = 'dealer' | 'dismantler' | 'exporter' | 'salvage'

export type IdForm = 'drivers_license' | 'state_id' | 'passport'

export type ApplicantProfile = {
  applicantType: 'business' | 'individual'
  country: string
  /** Two-letter code, or null before the applicant has told us. */
  state: string | null
  wantsGsa: boolean
  /** One entry per licence held. Empty means none. */
  licenses: readonly LicenseType[]
  /**
   * Declared by the applicant, not inferred. The live registration asks it
   * outright, and an address that does not match the ID needs separate proof.
   */
  addressDiffersFromId: boolean
  /**
   * Which document they are proving identity with. Declared, like the address
   * question above, because it decides which number they owe — filing an ID
   * card number under "Driver's license number" misdescribes it to the human
   * who later reads the record.
   */
  idForm: IdForm
}

/**
 * Every key of ApplicantProfile, as a runtime array — a type cannot be
 * enumerated at runtime, and the wire schema that has to accept all of them is
 * typed `Partial<ApplicantProfile>`, which does not force a matching entry.
 * `addressDiffersFromId` spent a whole task unreachable over the wire that way.
 */
export const ALL_PROFILE_KEYS = [
  'applicantType', 'country', 'state', 'wantsGsa', 'licenses',
  'addressDiffersFromId', 'idForm',
] as const satisfies readonly (keyof ApplicantProfile)[]

/** A profile key missing from the array above is a compile error, not a gap. */
type UnlistedProfileKey = Exclude<
  keyof ApplicantProfile, (typeof ALL_PROFILE_KEYS)[number]
>
const _everyProfileKeyIsListed: UnlistedProfileKey extends never
  ? true : UnlistedProfileKey = true
void _everyProfileKeyIsListed

/** Each document carries its own number, under its own name. */
export const ID_NUMBER: Readonly<Record<IdForm, FieldId>> = {
  drivers_license: 'dl_number',
  state_id: 'id_number',
  passport: 'passport_number',
}

/** Asked of everyone, on the first screen. */
export const CORE_PROFILE: readonly FieldId[] = [
  'primary_activity', 'preferred_language',
]

/**
 * Identity, in the order the panel asks it. A function rather than a list
 * because the declared document decides two of the entries — and their place
 * in the order matters: the number printed on the ID belongs beside the other
 * document fields, not after the request for photographs of it.
 */
export function identityFields(profile: ApplicantProfile): readonly FieldId[] {
  return [
    'first_name', 'last_name',
    ID_NUMBER[profile.idForm],
    'dl_expiry', 'id_country',
    // A passport has no issuing state, so asking for one has no answer.
    ...(profile.idForm === 'passport' ? [] : ['id_state' as const]),
    'dob', 'id_images',
  ]
}

export const CORE_ADDRESS: readonly FieldId[] = [
  'addr_line1', 'addr_city', 'addr_state', 'addr_zip',
]

export const CORE_CONTACT: readonly FieldId[] = ['phone_mobile']

export const BUSINESS_CORE: readonly FieldId[] = [
  'biz_name', 'biz_legal_name',
  'biz_addr_line1', 'biz_addr_city', 'biz_addr_state', 'biz_addr_zip',
  'biz_phone',
]

/** Repeated once per licence held. Emitted as instance-qualified keys. */
export const LICENSE_GROUP: readonly FieldId[] = [
  'license_type', 'license_number', 'license_effective',
  'license_expiry', 'license_country', 'license_image',
]

export const GSA_CORE: readonly FieldId[] = ['gsa_bidder_number', 'gsa_email']

export type StateRule = {
  /** Fields this state requires on top of the national baseline. */
  additional: readonly FieldId[]
  /** Why, in terms a compliance reviewer can check. */
  note: string
  /**
   * False until a compliance owner has confirmed this against the state's
   * current requirements. Encoding licensing rules is not a developer call.
   */
  signedOff: boolean
}

/** Keyed by upper-case two-letter code. Absent means national baseline only. */
export const STATE_RULES: Readonly<Record<string, StateRule>> = {
  GA: {
    additional: [],
    note: 'Georgia requires no additional forms beyond the national baseline.',
    signedOff: false,
  },
  OH: {
    additional: ['oh_foreign_buyer_form'],
    note: 'Ohio requires the Foreign and Qualifying Out of State Buyer Form '
      + 'before an out-of-state dealer may bid.',
    signedOff: false,
  },
}
