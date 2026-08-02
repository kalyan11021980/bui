import type { FieldId } from '../field-id'

export type ApplicantProfile = {
  applicantType: 'business' | 'individual'
  country: string
  /** Two-letter code, or null before the applicant has told us. */
  state: string | null
  wantsGsa: boolean
  licenseCount: number
}

export const CORE_IDENTITY: readonly FieldId[] = [
  'first_name', 'last_name', 'id_form', 'dl_number', 'dl_expiry',
  'dob', 'id_images',
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

export const LICENSE_CORE: readonly FieldId[] = [
  'license_type', 'license_number', 'license_effective',
  'license_expiry', 'license_image',
]

export const GSA_CORE: readonly FieldId[] = ['gsa_bidder_number', 'gsa_email']
