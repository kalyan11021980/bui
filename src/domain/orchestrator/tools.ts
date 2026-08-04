import { z } from 'zod'
import { profilePatch } from '../application/action-schema'
import { ALL_DOC_TYPES } from '../field-id'

/**
 * The whole of the agent's authority. Anything absent here it cannot do,
 * whatever it emits — see guard.ts, which is what actually enforces that.
 *
 * No schema here builds an AI SDK tool: src/domain must not import `ai`.
 */
export const ALL_TOOL_NAMES = [
  'askFor', 'explain', 'setProfile', 'requestDocument', 'orient',
] as const

export type ToolName = (typeof ALL_TOOL_NAMES)[number]

export const TOOL_SCHEMAS = Object.freeze({
  askFor: z.object({ fieldIds: z.array(z.string().min(1)).min(1).max(4) }).strict(),
  explain: z.object({ fieldId: z.string().min(1) }).strict(),
  setProfile: z.object({ patch: profilePatch }).strict(),
  requestDocument: z.object({ docType: z.enum(ALL_DOC_TYPES) }).strict(),
  orient: z.object({}).strict(),
})

export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = Object.freeze({
  askFor:
    'Ask the applicant for up to four outstanding fields. Each renders with its own vetted explanation. Only field ids listed as outstanding are accepted.',
  explain:
    'Show the vetted explanation for one field — what it is for and who requires it. Use when the applicant asks why something is needed.',
  setProfile:
    'Record what the applicant told you about who they are: individual or business, their state, which licences they hold, whether they want GSA access, which form of ID they carry.',
  requestDocument:
    'Ask the applicant to photograph one document. Only documents this applicant actually owes are accepted.',
  orient:
    'Show a returning applicant how far through they are. Use only on the first turn of a resumed application.',
})
