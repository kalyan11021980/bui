import type { FieldId } from '../field-id'
import {
  BUSINESS_CORE, CORE_ADDRESS, CORE_CONTACT, CORE_IDENTITY,
  GSA_CORE, LICENSE_CORE, type ApplicantProfile,
} from './rules'

/**
 * The single authority on what an applicant owes. Pure: same profile in,
 * same field list out. No LLM, no I/O. See spec §8.
 */
export function requiredFields(profile: ApplicantProfile): FieldId[] {
  const out: FieldId[] = [
    ...CORE_IDENTITY,
    ...CORE_ADDRESS,
    ...CORE_CONTACT,
  ]

  if (profile.applicantType === 'business') {
    out.push(...BUSINESS_CORE, 'tax_id')
    if (profile.licenseCount > 0) out.push(...LICENSE_CORE)
  }

  if (profile.wantsGsa) out.push(...GSA_CORE)

  return [...new Set(out)]
}
