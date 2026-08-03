import type { Action, ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import type { QualityBand } from '@/domain/ocr/quality'
import type { RequirementKey } from '@/domain/requirements/key'

/**
 * Every call the browser makes to the application API, and the only place a
 * request is built — the ownership header goes on once, here, rather than on
 * each call site.
 */

/**
 * Kept in step with OWNER_TOKEN_HEADER in @/server/ownership by a test. It
 * cannot be imported from there: that module reads node:crypto.
 */
export const OWNER_TOKEN_HEADER = 'x-owner-token'

export type ApiResult<T> =
  | { ok: true; value: T }
  /** `status` is null when the request never reached the server. */
  | { ok: false; status: number | null; message: string | null }

export type UploadOutcome = {
  readonly band: QualityBand
  /** What the server filed this upload as — the key the photo is held under. */
  readonly documentId: string
  readonly filled: readonly RequirementKey[]
  readonly state: ApplicationState
}

/** The one response that carries an owner token. Every later call presents it. */
export function startApplication(): Promise<ApiResult<ApplicationState>> {
  return post<ApplicationState>('/api/application', null)
}

export function sendAction(
  id: string,
  ownerToken: string | null,
  action: Action,
): Promise<ApiResult<ApplicationState>> {
  return post<ApplicationState>(`/api/application/${id}/actions`, ownerToken, { action })
}

/**
 * No `imageSize` in the body. The route is strict and would refuse one, because
 * it measures the bytes itself — the browser keeps its own copy of the size to
 * draw crops with, and that is all it is for.
 */
export function sendDocument(
  id: string,
  ownerToken: string | null,
  docType: DocType,
  imageBase64: string,
): Promise<ApiResult<UploadOutcome>> {
  return post<UploadOutcome>(
    `/api/application/${id}/documents`, ownerToken, { docType, imageBase64 },
  )
}

async function post<T>(
  path: string,
  ownerToken: string | null,
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ownerToken !== null && { [OWNER_TOKEN_HEADER]: ownerToken }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
  } catch {
    return { ok: false, status: null, message: null }
  }

  // A 500 is an unhandled throw, and Next answers those with an HTML page.
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload !== null && typeof payload === 'object' && 'error' in payload
      && typeof payload.error === 'string'
        ? payload.error
        : null
    return { ok: false, status: response.status, message }
  }

  return { ok: true, value: payload as T }
}
