import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'
import { phoneSchema } from './schemas'

export { phoneSchema } from './schemas'

export const CONTACT_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'phone_primary',
    label: 'Primary phone',
    type: 'phone',
    section: 'contact',
    purpose: 'The number Buyer Services calls about your account',
    authority: 'IAA_POLICY',
    validation: phoneSchema,
  }),
  defineField({
    id: 'phone_mobile',
    label: 'Mobile phone',
    type: 'phone',
    section: 'contact',
    purpose: 'So we can text you the moment your account is approved',
    authority: 'IAA_POLICY',
    validation: phoneSchema,
  }),
]
