import type { VettedCopyId } from './copy'
import type { DocType } from '../field-id'
import type { RequirementKey } from '../requirements/key'
import { COPY_VERSION, vettedCopy } from './copy'
import { SECTION_LABEL, type Section } from '../section'

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
  | { kind: 'section_header'; section: Section; done: number; total: number }

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
  /** Guard reason codes for tool calls refused on this turn. */
  rejections?: readonly string[]
}

/**
 * What the applicant was shown, as a stable string: the version, then each
 * block's identity and its resolved text. Hashed by the caller, which owns the
 * Digester — the domain stays free of the secret.
 */
export function shownCopyMaterial(
  blocks: readonly Block[],
  labelOf: (fieldId: RequirementKey) => string,
): string {
  const parts = blocks.map((b) => {
    switch (b.kind) {
      case 'field_ask': return `ask:${b.fieldId}:${labelOf(b.fieldId)}`
      case 'rationale': return `why:${b.fieldId}:${labelOf(b.fieldId)}`
      case 'document_request': return `doc:${b.docType}`
      case 'orientation': return `orient:${b.done}/${b.total}`
      case 'notice': return `notice:${b.copyId}:${vettedCopy(b.copyId)}`
      case 'section_header':
        return `section:${b.section}:${SECTION_LABEL[b.section]}:${b.done}/${b.total}`
    }
  })
  return `v${COPY_VERSION}|${parts.join('|')}`
}
