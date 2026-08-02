export type FieldId =
  // profile
  | 'applicant_type' | 'primary_activity' | 'preferred_language'
  | 'profile_country' | 'profile_state'
  // identity
  | 'first_name' | 'last_name' | 'id_form' | 'dl_number' | 'dl_expiry'
  | 'dob' | 'id_images'
  // personal address
  | 'addr_line1' | 'addr_line2' | 'addr_city' | 'addr_state' | 'addr_zip'
  // contact
  | 'phone_mobile' | 'phone_primary'
  // business
  | 'biz_name' | 'biz_legal_name'
  | 'biz_addr_line1' | 'biz_addr_line2' | 'biz_addr_city'
  | 'biz_addr_state' | 'biz_addr_zip' | 'biz_phone'
  // license
  | 'license_type' | 'license_number' | 'license_effective'
  | 'license_expiry' | 'license_image'
  // tax
  | 'tax_id'
  // gsa
  | 'gsa_bidder_number' | 'gsa_email'
  // state-specific forms
  | 'oh_foreign_buyer_form'

export type DocType =
  | 'drivers_license'
  | 'state_id'
  | 'passport'
  | 'dealer_license'
