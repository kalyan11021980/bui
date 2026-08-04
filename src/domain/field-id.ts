/**
 * A runtime array rather than a bare type union, so a test can check that every
 * declared id has a catalog entry. It did not, for five ids, for all of phase 1.
 *
 * Applicant type, country, state and form of ID are NOT here — they live on
 * `ApplicantProfile` as engine inputs. Two representations of one fact drift.
 */
export const ALL_FIELD_IDS = [
  // preferences
  'primary_activity', 'preferred_language',
  // identity
  'first_name', 'last_name', 'dl_number', 'id_number', 'passport_number',
  'dl_expiry', 'id_country', 'id_state', 'dob', 'id_images', 'proof_of_residency',
  // personal address
  'addr_line1', 'addr_city', 'addr_state', 'addr_zip',
  // contact
  'phone_mobile',
  // business
  'biz_name', 'biz_legal_name',
  'biz_addr_line1', 'biz_addr_city',
  'biz_addr_state', 'biz_addr_zip', 'biz_phone',
  // license
  'license_type', 'license_number', 'license_effective',
  'license_expiry', 'license_country', 'license_image',
  // tax
  'tax_id',
  // gsa
  'gsa_bidder_number', 'gsa_email',
  // state-specific forms
  'oh_foreign_buyer_form',
] as const

export type FieldId = (typeof ALL_FIELD_IDS)[number]

/** Runtime list, so the upload route's wire schema cannot drift from the type. */
export const ALL_DOC_TYPES = [
  'drivers_license', 'state_id', 'passport', 'dealer_license', 'proof_of_residency',
] as const

export type DocType = (typeof ALL_DOC_TYPES)[number]
