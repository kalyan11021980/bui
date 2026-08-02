import type { RequirementKey } from '../requirements/key'
import type { ApplicantProfile } from '../requirements/rules'

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
  rulesVersion: number
  profile: ApplicantProfile
  /** Keyed by RequirementKey — plain FieldId, or `id#n` for licences. */
  fields: Partial<Record<RequirementKey, FieldState>>
  submittedAt: string | null
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
  | { type: 'CONFIRM'; fieldId: RequirementKey; at: string; shownCopyHash: string }
  | { type: 'VERIFY'; fieldId: RequirementKey; at: string }
  | { type: 'REJECT'; fieldId: RequirementKey; at: string; reason: string }
  | { type: 'SUPERSEDE'; fieldId: RequirementKey; at: string }
  | { type: 'UPDATE_PROFILE'; patch: Partial<ApplicantProfile>; at: string }
