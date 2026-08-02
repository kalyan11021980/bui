import type { RequirementKey } from '../requirements/key'
import type { ProvenanceSource } from '../application/state'

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
}
