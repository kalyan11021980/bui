import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'
import { zipSchema } from './schemas'

export { zipSchema } from './schemas'

// A state ID prints the address as fully as a licence does — both ID specimens
// in the fixture corpus do, and OCR reads all four parts off them. Not line 2:
// neither prints an apartment line.
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
    section: 'address',
    purpose: 'Bidding rules and required documents differ by state',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().length(2, 'Select your state'),
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
]
