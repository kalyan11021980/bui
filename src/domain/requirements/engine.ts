import {
  BUSINESS_CORE, CORE_ADDRESS, CORE_CONTACT, CORE_PROFILE, GSA_CORE,
  identityFields, LICENSE_GROUP, STATE_RULES, type ApplicantProfile,
} from './rules'
import { reqKey, type RequirementKey } from './key'

/** The single authority on what an applicant owes. Pure — no LLM, no I/O. */
export function requiredFields(profile: ApplicantProfile): RequirementKey[] {
  const out: RequirementKey[] = [
    ...CORE_PROFILE, ...identityFields(profile),
    ...CORE_ADDRESS, ...CORE_CONTACT,
  ].map((id) => reqKey(id))

  if (profile.applicantType === 'business') {
    for (const id of BUSINESS_CORE) out.push(reqKey(id))
    out.push(reqKey('tax_id'))

    profile.licenses.forEach((_licence, index) => {
      for (const id of LICENSE_GROUP) out.push(reqKey(id, index))
    })
  }

  if (profile.wantsGsa) for (const id of GSA_CORE) out.push(reqKey(id))

  const rule = profile.state
    ? STATE_RULES[profile.state.toUpperCase()]
    : undefined
  if (rule) for (const id of rule.additional) out.push(reqKey(id))

  return [...new Set(out)]
}
