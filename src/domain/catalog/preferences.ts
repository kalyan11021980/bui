import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

/**
 * The "Complete your profile" step of the live registration. Applicant type,
 * country and state from that same screen are engine inputs on
 * `ApplicantProfile` rather than catalog fields.
 */
export const PREFERENCE_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'primary_activity',
    label: 'Primary activity',
    type: 'select',
    section: 'profile',
    purpose: 'Decides which vehicle categories you are allowed to bid on',
    authority: 'IAA_POLICY',
    // Free text until the live option list is confirmed. A guessed enum would
    // reject an answer the current registration accepts.
    validation: z.string().min(1, 'Tell us what you mainly do'),
    orchestratorVisible: true,
  }),
  defineField({
    id: 'preferred_language',
    label: 'Preferred language',
    type: 'select',
    section: 'profile',
    purpose: 'The language we write to you in about your account',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Choose a language'),
    orchestratorVisible: true,
  }),
]
