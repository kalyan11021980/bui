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
  /**
   * Removes the recorded answer, returning the field to outstanding.
   *
   * Distinct from `SET_VALUE` with a null value, which would have to be
   * exempted from the field's own catalog schema at the route (§8.2) and
   * would land as `confirmed` by the "the user typed it" rule — an empty
   * answer counting as done is the bug, not the fix.
   *
   * The trail is still append-only: the value that was there is in the
   * SET_VALUE that put it there, and this records that it stopped applying.
   */
  | { type: 'CLEAR_VALUE'; fieldId: RequirementKey; at: string }
  | { type: 'CONFIRM'; fieldId: RequirementKey; at: string; shownCopyHash: string }
  | { type: 'VERIFY'; fieldId: RequirementKey; at: string }
  | { type: 'REJECT'; fieldId: RequirementKey; at: string; reason: string }
  | { type: 'SUPERSEDE'; fieldId: RequirementKey; at: string }
  | { type: 'UPDATE_PROFILE'; patch: Partial<ApplicantProfile>; at: string }
  /**
   * Hands the application to review. Refused while anything is outstanding
   * (spec §8.2), which is not the same as disabling the button: the panel
   * always lets the attempt happen and answers with what is still missing.
   */
  | { type: 'SUBMIT'; at: string }
