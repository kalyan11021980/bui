import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const zipSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP code')

export const ADDRESS_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'addr_line1',
    label: 'Address',
    type: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your street address'),
    derivableFrom: ['drivers_license'],
  }),
  defineField({
    id: 'addr_line2',
    label: 'Address line 2',
    type: 'text',
    purpose: 'Apartment or suite, if you have one',
    authority: 'IAA_POLICY',
    validation: z.string().optional(),
  }),
  defineField({
    id: 'addr_city',
    label: 'City',
    type: 'text',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your city'),
    derivableFrom: ['drivers_license'],
  }),
  defineField({
    id: 'addr_state',
    label: 'State',
    type: 'select',
    purpose: 'Bidding rules and required documents differ by state',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().length(2, 'Select your state'),
    derivableFrom: ['drivers_license'],
    orchestratorVisible: true,
  }),
  defineField({
    id: 'addr_zip',
    label: 'ZIP code',
    type: 'text',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: zipSchema,
    derivableFrom: ['drivers_license'],
  }),
]
