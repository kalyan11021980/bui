import type { VettedCopyId } from './copy'
import type { DocType } from '../field-id'
import type { RequirementKey } from '../requirements/key'

/**
 * Blocks carry identifiers, not copy. The string is resolved from the catalog
 * at render time, so a copy revision cannot silently rewrite what the
 * transcript says was shown — that is what the shown-copy hash is for.
 */
export type Block =
  | { kind: 'field_ask'; fieldId: RequirementKey }
  | { kind: 'rationale'; fieldId: RequirementKey }
  | { kind: 'document_request'; docType: DocType }
  | { kind: 'orientation'; done: number; total: number }
  | { kind: 'notice'; copyId: VettedCopyId }

export type Turn = {
  /** 1-based within the application, like AuditEvent.seq. */
  seq: number
  at: string
  role: 'agent' | 'applicant'
  /** Linted model output, or null when dropped or when role is applicant. */
  voice: string | null
  voiceDropped?: 'lint' | 'sensitive'
  blocks: readonly Block[]
  /** Applicant turns only. Intent, never data. */
  text?: string
}
