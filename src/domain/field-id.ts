/**
 * A runtime array rather than a bare type union, so a test can check that every
 * declared id has a catalog entry. It did not, for five ids, for all of phase 1.
 *
 * The profile determinants ARE here: each is a catalog field bridged to its
 * `ApplicantProfile` key (see profile-bridge.ts), so one answer feeds both.
 */
export const ALL_FIELD_IDS = [
  // profile determinants
  'applicant_type', 'location_country', 'location_state', 'id_form',
  'address_differs', 'licenses_held', 'wants_gsa',
  // preferences
  'primary_activity', 'preferred_language',
  // identity — unchanged
  'first_name', 'last_name', 'dl_number', 'id_number', 'passport_number',
  'dl_expiry', 'id_country', 'id_state', 'dob', 'id_images', 'proof_of_residency',
  // personal address
  'addr_line1', 'addr_city', 'addr_state', 'addr_zip', 'addr_region', 'addr_postal',
  // contact
  'phone_primary', 'phone_mobile',
  // business
  'biz_name', 'biz_legal_name', 'biz_country',
  'biz_addr_line1', 'biz_addr_city',
  'biz_addr_state', 'biz_addr_zip', 'biz_addr_region', 'biz_addr_postal', 'biz_phone',
  // license — unchanged
  'license_type', 'license_number', 'license_effective',
  'license_expiry', 'license_country', 'license_image',
  // tax
  'tax_classification', 'tax_id', 'tax_certification',
  // gsa
  'gsa_bidder_number', 'gsa_email',
  // state-specific forms
  'oh_foreign_buyer_form', 'poa_form', 'bid_card',
] as const

export type FieldId = (typeof ALL_FIELD_IDS)[number]

/** Runtime list, so the upload route's wire schema cannot drift from the type. */
export const ALL_DOC_TYPES = [
  'drivers_license', 'state_id', 'passport', 'dealer_license', 'proof_of_residency',
] as const

export type DocType = (typeof ALL_DOC_TYPES)[number]
