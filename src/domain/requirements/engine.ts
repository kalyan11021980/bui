import {
  addressFields, businessFields, CORE_CONTACT, GSA_CORE,
  identityFields, LICENSE_GROUP, profileFields, STATE_RULES, TAX_CORE,
  type ApplicantProfile,
} from './rules'
import { reqKey, type RequirementKey } from './key'

/** The single authority on what an applicant owes. Pure — no LLM, no I/O. */
export function requiredFields(profile: ApplicantProfile): RequirementKey[] {
  const out: RequirementKey[] = [
    ...profileFields(profile), ...identityFields(profile),
    ...addressFields(profile), ...CORE_CONTACT,
  ].map((id) => reqKey(id))

  if (profile.applicantType === 'business') {
    for (const id of businessFields(profile)) out.push(reqKey(id))
    for (const id of TAX_CORE) out.push(reqKey(id))

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
