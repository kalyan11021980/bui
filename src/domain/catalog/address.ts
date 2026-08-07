import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'
import { US_STATES, usStateSchema } from './geography'
import { zipSchema } from './schemas'

export { zipSchema } from './schemas'

export const ADDRESS_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'addr_line1',
    label: 'Address',
    type: 'address',
    section: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your street address'),
    derivableFrom: ['drivers_license', 'state_id'],
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'addr_city',
    label: 'City',
    type: 'text',
    section: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your city'),
    derivableFrom: ['drivers_license', 'state_id'],
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'addr_state',
    label: 'State',
    type: 'select',
    options: US_STATES,
    section: 'address',
    purpose: 'Bidding rules and required documents differ by state',
    authority: 'STATE_DEALER_BOARD',
    validation: usStateSchema,
    derivableFrom: ['drivers_license', 'state_id'],
    orchestratorVisible: true,
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'addr_zip',
    label: 'ZIP code',
    type: 'text',
    section: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: zipSchema,
    derivableFrom: ['drivers_license', 'state_id'],
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'addr_region',
    label: 'State / province / region',
    type: 'text',
    section: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your region'),
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'addr_postal',
    label: 'Postal code',
    type: 'text',
    section: 'address',
    purpose: 'Where we send your title documents and payments',
    authority: 'IAA_POLICY',
    validation: z.string().min(1, 'Enter your postal code'),
    neverBulkConfirm: true,
  }),
]
