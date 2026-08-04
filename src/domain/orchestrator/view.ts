import { outstandingFields } from '../application/queries'
import type { ApplicationState, FieldStatus, ProvenanceSource } from '../application/state'
import { fieldDef } from '../catalog'
import type { DocType } from '../field-id'
import { documentsToUpload } from '../requirements/documents'
import { parseReqKey } from '../requirements/key'
import type { RequirementKey } from '../requirements/key'
import type { ApplicantProfile } from '../requirements/rules'

/** Rejections at which the agent stops offering its own tools for the rest of the application. */
export const PANEL_ONLY_THRESHOLD = 3

export type FieldView = {
  id: RequirementKey
  label: string
  status: FieldStatus
  sensitive: boolean
  source?: ProvenanceSource
  confidence?: number
  /** Only when the catalog allowlists it. See orchestratorVisible. */
  value?: string
}

export type OrchestratorView = {
  applicationId: string
  profile: ApplicantProfile
  outstanding: readonly FieldView[]
  settled: readonly FieldView[]
  documentsOutstanding: readonly DocType[]
  submitted: boolean
  rulesVersion: number
  /** Once true, the agent offers no tools of its own — see PANEL_ONLY_THRESHOLD. */
  panelOnly: boolean
}

/**
 * The only function on the model path that reads ApplicationState. Everything
 * downstream takes an OrchestratorView, so leaking a value takes an edit here
 * rather than a forgotten redaction at a call site.
 */
export function toOrchestratorView(
  state: ApplicationState,
  uploadedDocs: readonly DocType[],
): OrchestratorView {
  const outstandingKeys = new Set(outstandingFields(state))
  const outstanding: FieldView[] = []
  const settled: FieldView[] = []

  for (const key of Object.keys(state.fields)) {
    const field = state.fields[key]
    if (!field) continue
    const view = viewOf(key, field.status, field.provenance, field.value)
    ;(outstandingKeys.has(key) ? outstanding : settled).push(view)
  }

  for (const key of outstandingKeys) {
    if (state.fields[key]) continue
    outstanding.push(viewOf(key, 'empty', undefined, null))
  }

  const held = new Set(uploadedDocs)
  return {
    applicationId: state.id,
    profile: state.profile,
    outstanding,
    settled,
    documentsOutstanding: documentsToUpload(state.profile).filter((d) => !held.has(d)),
    submitted: state.submittedAt !== null,
    rulesVersion: state.rulesVersion,
    panelOnly: state.orchestratorRejections >= PANEL_ONLY_THRESHOLD,
  }
}

function viewOf(
  key: RequirementKey,
  status: FieldStatus,
  provenance: { source: ProvenanceSource; confidence?: number } | undefined,
  value: unknown,
): FieldView {
  // Fails closed, like AuditLog.append: not knowing whether a field is
  // sensitive is a reason to refuse, never to assume it is not.
  const def = fieldDef(parseReqKey(key).fieldId)
  const visible = def.sensitive !== true
    && (def as { orchestratorVisible?: boolean }).orchestratorVisible === true

  return {
    id: key,
    label: def.label,
    status,
    sensitive: def.sensitive === true,
    ...(provenance?.source !== undefined && { source: provenance.source }),
    ...(provenance?.confidence !== undefined && { confidence: provenance.confidence }),
    ...(visible && value !== null && value !== undefined && { value: String(value) }),
  }
}
