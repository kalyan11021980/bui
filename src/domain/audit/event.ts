import type { RequirementKey } from '../requirements/key'
import type { ProvenanceSource } from '../application/state'
import type { ApplicantProfile } from '../requirements/rules'

export type AuditKind =
  | 'value_set' | 'value_cleared' | 'confirmed' | 'verified'
  | 'rejected' | 'superseded' | 'profile_updated' | 'submitted'
  | 'agent_turn' | 'applicant_message' | 'rejection_recorded'

export type AuditEvent = {
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
  /** Hash of the copy the user was shown when they confirmed. */
  shownCopyHash?: string
  reason?: string
  /**
   * Recorded in the clear: the profile is the only input to the requirements
   * engine, so this is what changed the applicant's obligations. Nothing in
   * a profile is sensitive.
   */
  patch?: Partial<ApplicantProfile>
  /** The Turn.seq this event records. */
  turnSeq?: number
  /** Set when the voice slot was suppressed or linted away. */
  voiceDropped?: 'lint' | 'sensitive'
  /** Guard reason codes for tool calls refused this turn. */
  rejections?: readonly string[]
}
