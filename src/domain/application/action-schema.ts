import { z } from 'zod'
import type { Action } from './state'

/**
 * The wire shape of an Action, and the only sanctioned way to turn untrusted
 * input into one. Lives in the domain because it is pure — no I/O, no
 * network, no clock — and because spec §8.2 names this the enforcement
 * surface: the route handler uses it today, and the phase-3 orchestrator's
 * tool calls will be parsed through exactly the same schema rather than a
 * second, drifting copy.
 *
 * Every variant is `.strict()`: an unrecognised property is a rejected
 * request, not a silently dropped one. A caller sending `patch` alongside
 * `SET_VALUE` has misunderstood something, and guessing on their behalf is
 * how bad data gets in.
 */

const provenanceSource = z.enum(['ocr', 'user', 'lookup', 'carried'])
const timestamp = z.string().min(1, 'at is required')
const requirementKey = z.string().min(1, 'fieldId is required')

const setValue = z
  .object({
    type: z.literal('SET_VALUE'),
    fieldId: requirementKey,
    // Deliberately unconstrained here: the authority on what a value may be
    // is the field's OWN schema in the catalog, which the route runs once it
    // knows which field this is. A missing `value` arrives as `undefined` and
    // is rejected there by the field's schema.
    value: z.unknown(),
    source: provenanceSource,
    at: timestamp,
    documentId: z.string().optional(),
    box: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    confidence: z.number().optional(),
    fromFieldId: requirementKey.optional(),
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
 * Strict, because the profile is the ONLY input to the requirements engine.
 * An unrecognised key landing in the profile changes nothing today and
 * silently changes an applicant's legal obligations the day someone adds a
 * rule that reads it.
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

export const actionSchema = z.discriminatedUnion('type', [
  setValue, confirm, verify, reject, supersede, updateProfile,
])

export const requestBodySchema = z
  .object({ id: z.string().min(1, 'id is required'), action: actionSchema })
  .strict()

type ParsedAction = z.infer<typeof actionSchema>

/**
 * Rebuilds a real `Action` from parsed input.
 *
 * This is not ceremony. `exactOptionalPropertyTypes` distinguishes "absent"
 * from "present and undefined", and Zod's `.optional()` produces the latter,
 * so spreading the parsed object straight through would hand the reducer a
 * `documentId: undefined` that then lands in provenance as a real key. Each
 * optional is re-attached only when it actually has a value.
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
