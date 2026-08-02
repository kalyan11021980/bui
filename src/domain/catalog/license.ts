import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

export const LICENSE_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'license_type',
    label: 'License type',
    type: 'select',
    purpose: 'Different licenses unlock different vehicle categories',
    authority: 'STATE_DEALER_BOARD',
    validation: z.enum(['dealer', 'dismantler', 'exporter', 'salvage']),
  }),
  defineField({
    id: 'license_number',
    label: 'License number',
    type: 'text',
    purpose: 'We verify this against your state dealer board',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(3, 'Enter the license number'),
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_effective',
    label: 'License effective date',
    type: 'date',
    purpose: 'Confirms the license is currently active',
    authority: 'STATE_DEALER_BOARD',
    validation: isoDate,
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_expiry',
    label: 'License expiration date',
    type: 'date',
    purpose: 'We will remind you before it lapses so bidding never stops',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'Bidding is suspended automatically when a license expires.',
    validation: isoDate,
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_image',
    label: 'Photo of your license',
    type: 'file',
    purpose: 'A person on our team checks it against your state board record',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string().min(1)).min(1, 'Upload your license'),
  }),
]
