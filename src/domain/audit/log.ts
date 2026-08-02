import type { Action, ProvenanceSource } from '../application/state'
import { fieldDef } from '../catalog'
import { parseReqKey } from '../requirements/key'
import type { AuditEvent, AuditKind } from './event'
import type { Digester } from './digest'

const KIND: Record<Action['type'], AuditKind> = {
  SET_VALUE: 'value_set',
  CONFIRM: 'confirmed',
  VERIFY: 'verified',
  REJECT: 'rejected',
  SUPERSEDE: 'superseded',
  UPDATE_PROFILE: 'profile_updated',
  SUBMIT: 'submitted',
}

/**
 * Append-only. There is deliberately no delete, no edit, no undo.
 *
 * Events are partitioned by application id: `seq` counts within one
 * application, so two concurrent applicants cannot interleave into a single
 * unreadable stream (spec §10.1). The global insertion order is kept
 * alongside purely so `entries()` can expose it.
 */
export class AuditLog {
  /** Per-application trails, each in its own append order. */
  #byApplication = new Map<string, AuditEvent[]>()
  /** Every event, in the order it was appended across all applications. */
  #all: AuditEvent[] = []
  #digest: Digester

  constructor(digester: Digester) {
    this.#digest = digester
  }

  append(applicationId: string, action: Action): AuditEvent {
    if (applicationId === '') {
      throw new Error('Audit events must name the application they belong to')
    }
    // Fail CLOSED. `fieldDef` THROWS on an unrecognised id; the previous
    // `CATALOG.get(...)?.sensitive` was silent, so an unknown id fell through
    // to the raw-value branch and a mistyped `tax_id` wrote a plaintext SSN
    // into the log. This resolution happens before anything is built, so a
    // refused append leaves no partial entry behind. Not knowing whether a
    // field is sensitive is a reason to refuse, never a reason to assume it
    // is not. Every action type carrying a fieldId is checked, not just
    // SET_VALUE — an id that cannot be resolved is never safe to record.
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
    // Copied, not referenced: the event is frozen, and a caller holding the
    // original patch object must not be able to rewrite history through it.
    const profilePart = action.type === 'UPDATE_PROFILE'
      ? { patch: Object.freeze({ ...action.patch }) }
      : {}

    // Build the event completely before freezing — assigning a property
    // after Object.freeze either silently no-ops or throws (strict mode),
    // so every field must be known up front, not patched on afterward.
    const trail = this.#byApplication.get(applicationId) ?? []
    const event: AuditEvent = Object.freeze({
      applicationId,
      seq: trail.length + 1,
      at: action.at,
      kind: KIND[action.type],
      ...fieldIdPart,
      ...valuePart,
      ...confirmPart,
      ...rejectPart,
      ...profilePart,
    })

    trail.push(event)
    this.#byApplication.set(applicationId, trail)
    this.#all.push(event)
    return event
  }

  /**
   * The trail for one application, in append order, `seq` running 1..n.
   * This is the compliance-facing read: it is what gets handed over when
   * someone asks how a single applicant's record came to say what it says.
   */
  entriesFor(applicationId: string): readonly AuditEvent[] {
    return Object.freeze([...(this.#byApplication.get(applicationId) ?? [])])
  }

  /**
   * EVERY event in this log, across EVERY application, in global insertion
   * order. Deliberately not the compliance read — `seq` values repeat across
   * applications here. Useful for tests and for whole-process inspection;
   * use `entriesFor` for anything applicant-facing.
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
