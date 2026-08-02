import type { FieldId } from '../field-id'

export type LicenseType = 'dealer' | 'dismantler' | 'exporter' | 'salvage'

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
}

/** Asked of everyone, on the first screen. */
export const CORE_PROFILE: readonly FieldId[] = [
  'primary_activity', 'preferred_language',
]

export const CORE_IDENTITY: readonly FieldId[] = [
  'first_name', 'last_name', 'id_form', 'dl_number', 'dl_expiry',
  'id_country', 'id_state', 'dob', 'id_images',
]

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
