import type { RequirementKey } from '../requirements/key'
import type { ProvenanceSource } from '../application/state'

export type AuditKind =
  | 'value_set' | 'confirmed' | 'verified'
  | 'rejected' | 'superseded' | 'profile_updated'

export type AuditEvent = {
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
