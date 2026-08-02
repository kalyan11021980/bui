import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const GSA_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'gsa_bidder_number',
    label: 'GSA bidder number',
    type: 'text',
    section: 'gsa',
    purpose: 'Links your GSA Fleet account so you can bid on government vehicles',
    authority: 'GSA',
    consequence: 'Skip this and you simply will not see GSA lots.',
    validation: z.string().min(1, 'Enter your GSA bidder number'),
  }),
  defineField({
    id: 'gsa_email',
    label: 'GSA fleet email address',
    type: 'text',
    section: 'gsa',
    purpose: 'Must match the email on your GSA Fleet account',
    authority: 'GSA',
    validation: z.string().email('Enter the email on your GSA account'),
  }),
]
