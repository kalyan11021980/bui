import type { Action, ProvenanceSource } from '../application/state'
import { CATALOG } from '../catalog'
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
}

/** Append-only. There is deliberately no delete, no edit, no undo. */
export class AuditLog {
  #entries: AuditEvent[] = []
  #digest: Digester

  constructor(digester: Digester) {
    this.#digest = digester
  }

  append(action: Action): AuditEvent {
    const fieldIdPart = 'fieldId' in action ? { fieldId: action.fieldId } : {}

    let valuePart: { source?: ProvenanceSource; value?: unknown; valueDigest?: string } = {}
    if (action.type === 'SET_VALUE') {
      const def = CATALOG.get(parseReqKey(action.fieldId).fieldId)
      valuePart = def?.sensitive
        ? { source: action.source, valueDigest: this.#digest(JSON.stringify(action.value)) }
        : { source: action.source, value: action.value }
    }

    const confirmPart = action.type === 'CONFIRM' ? { shownCopyHash: action.shownCopyHash } : {}
    const rejectPart = action.type === 'REJECT' ? { reason: action.reason } : {}

    // Build the event completely before freezing — assigning a property
    // after Object.freeze either silently no-ops or throws (strict mode),
    // so every field must be known up front, not patched on afterward.
    const event: AuditEvent = Object.freeze({
      seq: this.#entries.length + 1,
      at: action.at,
      kind: KIND[action.type],
      ...fieldIdPart,
      ...valuePart,
      ...confirmPart,
      ...rejectPart,
    })

    this.#entries.push(event)
    return event
  }

  entries(): readonly AuditEvent[] {
    return Object.freeze([...this.#entries])
  }

  size(): number {
    return this.#entries.length
  }
}
