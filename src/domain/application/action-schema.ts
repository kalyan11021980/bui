import { z } from 'zod'
import type { Action } from './state'

/**
 * The wire shape of an Action, and the only sanctioned way to turn untrusted
 * input into one. Phase 3's orchestrator tool calls parse through this same
 * schema rather than a second, drifting copy.
 *
 * Every variant is `.strict()`: an unrecognised property is a rejected
 * request, not a silently dropped one.
 */

const provenanceSource = z.enum(['ocr', 'user', 'lookup', 'carried'])
const timestamp = z.string().min(1, 'at is required')
const requirementKey = z.string().min(1, 'fieldId is required')

const setValue = z
  .object({
    type: z.literal('SET_VALUE'),
    fieldId: requirementKey,
    // Unconstrained here: the authority is the field's own catalog schema,
    // which the route runs once it knows which field this is.
    value: z.unknown(),
    source: provenanceSource,
    at: timestamp,
    documentId: z.string().optional(),
    box: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    confidence: z.number().optional(),
    fromFieldId: requirementKey.optional(),
  })
  .strict()

const clearValue = z
  .object({
    type: z.literal('CLEAR_VALUE'),
    fieldId: requirementKey,
    at: timestamp,
  })
  .strict()

const confirm = z
  .object({
    type: z.literal('CONFIRM'),
    fieldId: requirementKey,
    at: timestamp,
    shownCopyHash: z.string().min(1, 'shownCopyHash is required'),
  })
  .strict()

const verify = z
  .object({ type: z.literal('VERIFY'), fieldId: requirementKey, at: timestamp })
  .strict()

const reject = z
  .object({
    type: z.literal('REJECT'),
    fieldId: requirementKey,
    at: timestamp,
    reason: z.string().min(1, 'reason is required'),
  })
  .strict()

const supersede = z
  .object({ type: z.literal('SUPERSEDE'), fieldId: requirementKey, at: timestamp })
  .strict()

const licenseType = z.enum(['dealer', 'dismantler', 'exporter', 'salvage'])

/**
 * Strict because the profile is the only input to the requirements engine: an
 * unrecognised key changes nothing today and changes an applicant's legal
 * obligations the day a rule reads it.
 */
const profilePatch = z
  .object({
    applicantType: z.enum(['business', 'individual']).optional(),
    country: z.string().min(1).optional(),
    state: z.string().nullable().optional(),
    wantsGsa: z.boolean().optional(),
    licenses: z.array(licenseType).optional(),
  })
  .strict()

const updateProfile = z
  .object({
    type: z.literal('UPDATE_PROFILE'),
    patch: profilePatch,
    at: timestamp,
  })
  .strict()

const submit = z
  .object({ type: z.literal('SUBMIT'), at: timestamp })
  .strict()

export const actionSchema = z.discriminatedUnion('type', [
  setValue, clearValue, confirm, verify, reject, supersede, updateProfile,
  submit,
])

/** The body of `POST /api/application/[id]/actions`. The id comes from the path. */
export const actionRequestSchema = z.object({ action: actionSchema }).strict()

/** The same call with the application named in the envelope, for callers that
 * cannot address it in a URL — the shape phase 3's tool calls parse through. */
export const requestBodySchema = z
  .object({ id: z.string().min(1, 'id is required'), action: actionSchema })
  .strict()

type ParsedAction = z.infer<typeof actionSchema>

/**
 * Rebuilds a real `Action` from parsed input. Optionals are re-attached one
 * at a time because Zod's `.optional()` produces "present and undefined",
 * which `exactOptionalPropertyTypes` treats as a real key — spreading would
 * land `documentId: undefined` in provenance.
 */
export function toAction(parsed: ParsedAction): Action {
  switch (parsed.type) {
    case 'SET_VALUE':
      return {
        type: 'SET_VALUE',
        fieldId: parsed.fieldId,
        value: parsed.value,
        source: parsed.source,
        at: parsed.at,
        ...(parsed.documentId !== undefined && { documentId: parsed.documentId }),
        ...(parsed.box !== undefined && { box: parsed.box }),
        ...(parsed.confidence !== undefined && { confidence: parsed.confidence }),
        ...(parsed.fromFieldId !== undefined && { fromFieldId: parsed.fromFieldId }),
      }
    case 'CLEAR_VALUE':
      return { type: 'CLEAR_VALUE', fieldId: parsed.fieldId, at: parsed.at }
    case 'CONFIRM':
      return {
        type: 'CONFIRM', fieldId: parsed.fieldId, at: parsed.at,
        shownCopyHash: parsed.shownCopyHash,
      }
    case 'VERIFY':
      return { type: 'VERIFY', fieldId: parsed.fieldId, at: parsed.at }
    case 'REJECT':
      return {
        type: 'REJECT', fieldId: parsed.fieldId, at: parsed.at,
        reason: parsed.reason,
      }
    case 'SUPERSEDE':
      return { type: 'SUPERSEDE', fieldId: parsed.fieldId, at: parsed.at }
    case 'SUBMIT':
      return { type: 'SUBMIT', at: parsed.at }
    case 'UPDATE_PROFILE': {
      const p = parsed.patch
      return {
        type: 'UPDATE_PROFILE',
        at: parsed.at,
        patch: {
          ...(p.applicantType !== undefined && { applicantType: p.applicantType }),
          ...(p.country !== undefined && { country: p.country }),
          ...(p.state !== undefined && { state: p.state }),
          ...(p.wantsGsa !== undefined && { wantsGsa: p.wantsGsa }),
          ...(p.licenses !== undefined && { licenses: p.licenses }),
        },
      }
    }
  }
}

/** Flattens a Zod error into one line a caller can act on. */
export function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
}
