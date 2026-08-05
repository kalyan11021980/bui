import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

/**
 * The "Complete your profile" step of the live registration. Applicant type,
 * country and state from that same screen are engine inputs on
 * `ApplicantProfile` rather than catalog fields.
 */
export const PREFERENCE_FIELDS: readonly FieldDef[] = [
  // Both are typed `text`, not `select`: IAA's live option lists are not
  // confirmed, and a guessed enum would reject an answer the current
  // registration accepts. Typing them as a select we cannot populate is
  // worse — it renders as a dropdown that looks broken.
  defineField({
    id: 'primary_activity',
    label: 'Primary activity',
    type: 'text',
    example: 'Rebuilding and reselling salvage cars',
    section: 'profile',
    purpose: 'Decides which vehicle categories you are allowed to bid on',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Tell us what you mainly do'),
    orchestratorVisible: true,
  }),
  defineField({
    id: 'preferred_language',
    label: 'Preferred language',
    type: 'text',
    example: 'English',
    section: 'profile',
    purpose: 'The language we write to you in about your account',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Tell us which language suits you'),
    orchestratorVisible: true,
  }),
]
