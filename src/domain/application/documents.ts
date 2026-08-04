import type { DocType } from '../field-id'
import type { ApplicationState } from './state'

/** The kinds held, deduplicated — what the requirements side asks about. */
export function uploadedDocTypes(state: ApplicationState): readonly DocType[] {
  return [...new Set(state.documents.map((d) => d.docType))]
}
