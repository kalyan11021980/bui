import { outstandingFields } from '../application/queries'
import type { Action, ApplicationState } from '../application/state'
import { CATALOG } from '../catalog'
import type { DocType } from '../field-id'
import { documentsToUpload } from '../requirements/documents'
import { parseReqKey } from '../requirements/key'
import type { ApplicantProfile } from '../requirements/rules'
import type { Block } from './transcript'
import { ALL_TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from './tools'

/**
 * The security boundary of phase 3: every code the guard can return for
 * refusing a tool call. A model that misbehaves produces one of these, never
 * a bad application.
 */
export type RejectionCode =
  | 'ask_cardinality' | 'field_not_outstanding' | 'unknown_field'
  | 'duplicate_field' | 'malformed_patch' | 'empty_patch'
  | 'document_not_required' | 'document_already_held'
  | 'application_closed' | 'unknown_tool'

export type ToolCall = { toolName: string; input: unknown }

export type GuardOutcome =
  | { ok: true; blocks: readonly Block[]; actions: readonly Action[] }
  | { ok: false; code: RejectionCode }

const reject = (code: RejectionCode): GuardOutcome => ({ ok: false, code })

/**
 * Maps a tool call to a validated Action plus render blocks, or a typed
 * rejection. The model chooses what to ask next; this is what stops it from
 * inventing a field, skipping a requirement, or closing the application.
 */
export function guardToolCall(
  call: ToolCall,
  state: ApplicationState,
  uploadedDocs: readonly DocType[],
  at: string,
): GuardOutcome {
  // Runs before tool-name resolution and schema parsing: a closed
  // application refuses everything, whatever the call carries.
  if (state.submittedAt !== null) return reject('application_closed')

  if (!isToolName(call.toolName)) return reject('unknown_tool')
  const name = call.toolName

  // Parsed inside each case, keyed on its own literal schema, rather than
  // once via `TOOL_SCHEMAS[name]`: indexing by the widened `ToolName` union
  // collapses the result's `.data` to `{}`, which is what the cast in the
  // brief's sample was working around.
  switch (name) {
    case 'askFor': {
      const parsed = TOOL_SCHEMAS.askFor.safeParse(call.input)
      if (!parsed.success) return reject('ask_cardinality')
      const { fieldIds } = parsed.data
      // Validated as a unit: one bad id rejects the whole call rather than
      // asking for the subset that passed.
      if (new Set(fieldIds).size !== fieldIds.length) return reject('duplicate_field')
      const outstanding = new Set(outstandingFields(state))
      for (const id of fieldIds) {
        if (!knownField(id)) return reject('unknown_field')
        if (!outstanding.has(id)) return reject('field_not_outstanding')
      }
      const blocks: Block[] = fieldIds.map((fieldId) => ({ kind: 'field_ask', fieldId }))
      return { ok: true, blocks, actions: [] }
    }

    case 'explain': {
      const parsed = TOOL_SCHEMAS.explain.safeParse(call.input)
      if (!parsed.success) return reject('unknown_field')
      const { fieldId } = parsed.data
      if (!knownField(fieldId)) return reject('unknown_field')
      const settled = new Set([...outstandingFields(state), ...Object.keys(state.fields)])
      if (!settled.has(fieldId)) return reject('unknown_field')
      return { ok: true, blocks: [{ kind: 'rationale', fieldId }], actions: [] }
    }

    case 'setProfile': {
      const parsed = TOOL_SCHEMAS.setProfile.safeParse(call.input)
      if (!parsed.success) return reject('malformed_patch')
      if (Object.keys(parsed.data.patch).length === 0) return reject('empty_patch')
      // Built directly rather than through `toAction`: `profilePatch` has
      // already validated the shape, and routing a typed value back through
      // the wire parser would need a cast to satisfy it. Reattached one key
      // at a time — Zod's `.optional()` yields "present and undefined",
      // which `exactOptionalPropertyTypes` treats as a real key.
      const p = parsed.data.patch
      const patch: Partial<ApplicantProfile> = {
        ...(p.applicantType !== undefined && { applicantType: p.applicantType }),
        ...(p.country !== undefined && { country: p.country }),
        ...(p.state !== undefined && { state: p.state }),
        ...(p.wantsGsa !== undefined && { wantsGsa: p.wantsGsa }),
        ...(p.licenses !== undefined && { licenses: p.licenses }),
        ...(p.addressDiffersFromId !== undefined
          && { addressDiffersFromId: p.addressDiffersFromId }),
        ...(p.idForm !== undefined && { idForm: p.idForm }),
      }
      return {
        ok: true,
        blocks: [],
        actions: [{ type: 'UPDATE_PROFILE', patch, at }],
      }
    }

    case 'requestDocument': {
      const parsed = TOOL_SCHEMAS.requestDocument.safeParse(call.input)
      if (!parsed.success) return reject('document_not_required')
      const { docType } = parsed.data
      if (!documentsToUpload(state.profile).includes(docType)) {
        return reject('document_not_required')
      }
      if (uploadedDocs.includes(docType)) return reject('document_already_held')
      return { ok: true, blocks: [{ kind: 'document_request', docType }], actions: [] }
    }

    case 'orient': {
      const total = outstandingFields(state).length + Object.keys(state.fields).length
      return {
        ok: true,
        blocks: [{
          kind: 'orientation',
          done: total - outstandingFields(state).length,
          total,
        }],
        actions: [],
      }
    }
  }
}

function knownField(key: string): boolean {
  try {
    return CATALOG.has(parseReqKey(key).fieldId)
  } catch {
    return false
  }
}

function isToolName(name: string): name is ToolName {
  return ALL_TOOL_NAMES.some((n) => n === name)
}
