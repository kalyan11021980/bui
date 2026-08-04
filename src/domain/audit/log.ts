import type { Action, ProvenanceSource } from '../application/state'
import { fieldDef } from '../catalog'
import { parseReqKey } from '../requirements/key'
import { shownCopyMaterial } from '../orchestrator/transcript'
import type { AuditEvent, AuditKind } from './event'
import type { Digester } from './digest'

const KIND: Record<Exclude<Action['type'], 'APPEND_TURN'>, AuditKind> = {
  SET_VALUE: 'value_set',
  // Carries no `value`: the old one is already in the SET_VALUE that put it
  // there, digested if sensitive. Repeating it opens a second plaintext path.
  CLEAR_VALUE: 'value_cleared',
  CONFIRM: 'confirmed',
  VERIFY: 'verified',
  REJECT: 'rejected',
  SUPERSEDE: 'superseded',
  UPDATE_PROFILE: 'profile_updated',
  SUBMIT: 'submitted',
  RECORD_REJECTION: 'rejection_recorded',
}

/**
 * Append-only: no delete, no edit, no undo. Partitioned by application id, so
 * `seq` counts within one application and two concurrent applicants cannot
 * interleave into one unreadable stream.
 */
export class AuditLog {
  #byApplication = new Map<string, AuditEvent[]>()
  /** Every event, in global append order across all applications. */
  #all: AuditEvent[] = []
  #digest: Digester

  constructor(digester: Digester) {
    this.#digest = digester
  }

  append(applicationId: string, action: Action): AuditEvent {
    if (applicationId === '') {
      throw new Error('Audit events must name the application they belong to')
    }
    // Fail CLOSED, before anything is built: `fieldDef` throws on an
    // unrecognised id, so a mistyped `tax_id` cannot fall through to the
    // raw-value branch and write a plaintext SSN. Not knowing whether a field
    // is sensitive is a reason to refuse, never to assume it is not.
    if ('fieldId' in action) fieldDef(parseReqKey(action.fieldId).fieldId)
    const fieldIdPart = 'fieldId' in action ? { fieldId: action.fieldId } : {}

    let valuePart: { source?: ProvenanceSource; value?: unknown; valueDigest?: string } = {}
    if (action.type === 'SET_VALUE') {
      const def = fieldDef(parseReqKey(action.fieldId).fieldId)
      valuePart = def.sensitive
        ? { source: action.source, valueDigest: this.#digest(JSON.stringify(action.value)) }
        : { source: action.source, value: action.value }
    }

    const confirmPart = action.type === 'CONFIRM' ? { shownCopyHash: action.shownCopyHash } : {}
    const rejectPart = action.type === 'REJECT' ? { reason: action.reason } : {}
    // Copied, not referenced: a caller holding the original patch object must
    // not be able to rewrite a frozen event through it.
    const profilePart = action.type === 'UPDATE_PROFILE'
      ? { patch: Object.freeze({ ...action.patch }) }
      : {}

    let turnPart: Partial<AuditEvent> = {}
    if (action.type === 'APPEND_TURN') {
      const turn = action.turn
      turnPart = {
        turnSeq: turn.seq,
        shownCopyHash: this.#digest(
          shownCopyMaterial(turn.blocks, (id) => fieldDef(parseReqKey(id).fieldId).label),
        ),
        ...(turn.voiceDropped !== undefined && { voiceDropped: turn.voiceDropped }),
        ...(turn.rejections !== undefined && turn.rejections.length > 0
          && { rejections: Object.freeze([...turn.rejections]) }),
      }
    }

    // APPEND_TURN's kind depends on turn.role, which the static KIND map
    // above cannot express.
    const kind: AuditKind = action.type === 'APPEND_TURN'
      ? (action.turn.role === 'agent' ? 'agent_turn' : 'applicant_message')
      : KIND[action.type]

    const trail = this.#byApplication.get(applicationId) ?? []
    const event: AuditEvent = Object.freeze({
      applicationId,
      seq: trail.length + 1,
      at: action.at,
      kind,
      ...fieldIdPart,
      ...valuePart,
      ...confirmPart,
      ...rejectPart,
      ...profilePart,
      ...turnPart,
    })

    trail.push(event)
    this.#byApplication.set(applicationId, trail)
    this.#all.push(event)
    return event
  }

  /** The compliance-facing read: one application, `seq` running 1..n. */
  entriesFor(applicationId: string): readonly AuditEvent[] {
    return Object.freeze([...(this.#byApplication.get(applicationId) ?? [])])
  }

  /**
   * Every event across every application, in global insertion order. Not the
   * compliance read — `seq` values repeat here. Use `entriesFor` for that.
   */
  entries(): readonly AuditEvent[] {
    return Object.freeze([...this.#all])
  }

  /** Total events across all applications. */
  size(): number {
    return this.#all.length
  }

  /** Events recorded for one application. */
  sizeFor(applicationId: string): number {
    return this.#byApplication.get(applicationId)?.length ?? 0
  }
}
