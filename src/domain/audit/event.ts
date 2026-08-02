import type { RequirementKey } from '../requirements/key'
import type { ProvenanceSource } from '../application/state'
import type { ApplicantProfile } from '../requirements/rules'

export type AuditKind =
  | 'value_set' | 'confirmed' | 'verified'
  | 'rejected' | 'superseded' | 'profile_updated'

export type AuditEvent = {
  /**
   * Which application this event belongs to. Required, not optional: spec
   * §10.1 requires that *every application* carries its own append-only
   * trail, and a trail with no discriminator cannot be reconstructed for a
   * single applicant no matter what storage sits underneath it (phase 4).
   */
  applicationId: string
  /** 1-based, and scoped to `applicationId` — not to the process. */
  seq: number
  at: string
  kind: AuditKind
  fieldId?: RequirementKey
  source?: ProvenanceSource
  /** Present only for non-sensitive fields. */
  value?: unknown
  /** Present instead of `value` for sensitive fields. */
  valueDigest?: string
  /** Hash of the copy the user was shown when they confirmed. Spec §10.1. */
  shownCopyHash?: string
  reason?: string
  /**
   * What a `profile_updated` event actually changed. Recorded in full and in
   * the clear: the profile is the ONLY input to the requirements engine, so
   * `applicantType`, `state` and `licenses` are precisely what change an
   * applicant's legal obligations, and "something about the profile changed"
   * reconstructs nothing. No profile field is sensitive — there is no
   * taxpayer ID or date of birth in here to digest.
   */
  patch?: Partial<ApplicantProfile>
}
