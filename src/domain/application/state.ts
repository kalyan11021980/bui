import type { RequirementKey } from '../requirements/key'
import type { ApplicantProfile } from '../requirements/rules'
import type { Turn } from '../orchestrator/transcript'

export type FieldStatus =
  | 'empty' | 'derived' | 'confirmed' | 'verified' | 'rejected' | 'superseded'

export type ProvenanceSource = 'ocr' | 'user' | 'lookup' | 'carried'

export type Provenance = {
  source: ProvenanceSource
  documentId?: string
  /** Original-image coordinates. Absent when the provider cannot supply them. */
  box?: readonly [number, number, number, number]
  confidence?: number
  /** For `carried` values: the RequirementKey the value was copied from. */
  fromFieldId?: RequirementKey
}

export type FieldState<T = unknown> = {
  value: T | null
  status: FieldStatus
  provenance?: Provenance
  rejection?: { reason: string; at: string }
}

export type ApplicationState = {
  id: string
  /**
   * A capability, not authentication: no session, no login, no identity behind
   * it. It only makes knowing an id insufficient to read or change the record.
   *
   * Null on every response but the one that creates the application — the
   * server keeps the real one and never echoes it back.
   */
  ownerToken: string | null
  rulesVersion: number
  profile: ApplicantProfile
  /** Keyed by RequirementKey — plain FieldId, or `id#n` for licences. */
  fields: Partial<Record<RequirementKey, FieldState>>
  submittedAt: string | null
  /** Agent and applicant turns, in order. Empty until phase 3 writes one. */
  transcript: readonly Turn[]
  /** Guard rejections on this application. Three drops it to panel-only. */
  orchestratorRejections: number
}

export type Action =
  | {
      type: 'SET_VALUE'
      fieldId: RequirementKey
      value: unknown
      source: ProvenanceSource
      at: string
      documentId?: string
      box?: readonly [number, number, number, number]
      confidence?: number
      fromFieldId?: RequirementKey
    }
  /**
   * Removes the recorded answer, returning the field to outstanding. Distinct
   * from `SET_VALUE` with null, which the field's own catalog schema would
   * have to exempt and which would land as `confirmed`.
   */
  | { type: 'CLEAR_VALUE'; fieldId: RequirementKey; at: string }
  | { type: 'CONFIRM'; fieldId: RequirementKey; at: string; shownCopyHash: string }
  | { type: 'VERIFY'; fieldId: RequirementKey; at: string }
  | { type: 'REJECT'; fieldId: RequirementKey; at: string; reason: string }
  | { type: 'SUPERSEDE'; fieldId: RequirementKey; at: string }
  | { type: 'UPDATE_PROFILE'; patch: Partial<ApplicantProfile>; at: string }
  /** Refused while anything is outstanding. */
  | { type: 'SUBMIT'; at: string }
  | { type: 'APPEND_TURN'; turn: Turn; at: string }
  | { type: 'RECORD_REJECTION'; at: string }
