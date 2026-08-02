import type { Action } from '../application/state'
import { CATALOG } from '../catalog'
import { parseReqKey } from '../requirements/key'
import type { AuditEvent, AuditKind } from './event'

/**
 * Small, stable, non-cryptographic digest (FNV-1a). Enough to prove a value
 * did not change between events without storing the value itself. Swap for a
 * keyed hash if the audit log ever leaves our infrastructure.
 */
export function digest(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

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

  append(action: Action): AuditEvent {
    const base: AuditEvent = {
      seq: this.#entries.length + 1,
      at: action.at,
      kind: KIND[action.type],
    }

    if (action.type !== 'UPDATE_PROFILE') base.fieldId = action.fieldId

    if (action.type === 'SET_VALUE') {
      base.source = action.source
      const def = CATALOG.get(parseReqKey(action.fieldId).fieldId)
      if (def?.sensitive) {
        base.valueDigest = digest(String(action.value))
      } else {
        base.value = action.value
      }
    }

    if (action.type === 'CONFIRM') base.shownCopyHash = action.shownCopyHash
    if (action.type === 'REJECT') base.reason = action.reason

    this.#entries.push(base)
    return base
  }

  entries(): readonly AuditEvent[] {
    return Object.freeze([...this.#entries])
  }

  size(): number {
    return this.#entries.length
  }
}
