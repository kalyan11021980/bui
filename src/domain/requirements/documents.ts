import type { DocType } from '../field-id'
import type { ApplicantProfile } from './rules'

/**
 * The documents this applicant is asked to photograph, in the order they are
 * asked for: the ID they said they hold, then whatever else their profile
 * actually owes.
 *
 * Never more than that. A photograph of a document nothing in the application
 * asks about is one we take, read and cannot use — and the applicant went and
 * found it for us.
 */
export function documentsToUpload(profile: ApplicantProfile): readonly DocType[] {
  return [
    profile.idForm,
    // Every licence group asks for a number, dates and the business name, and
    // the licence itself carries all of them.
    ...(profile.licenses.length > 0 ? ['dealer_license' as const] : []),
    // Required of anyone whose address is not the one on their ID.
    ...(profile.addressDiffersFromId ? ['proof_of_residency' as const] : []),
  ]
}
