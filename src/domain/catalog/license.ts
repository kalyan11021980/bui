import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'
import { isoDate } from './schemas'

export const LICENSE_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'license_type',
    label: 'License type',
    type: 'select',
    section: 'license',
    purpose: 'Different licenses unlock different vehicle categories',
    authority: 'STATE_DEALER_BOARD',
    validation: z.enum(['dealer', 'dismantler', 'exporter', 'salvage']),
  }),
  defineField({
    id: 'license_number',
    label: 'License number',
    type: 'text',
    section: 'license',
    purpose: 'We verify this against your state dealer board',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(3, 'Enter the license number'),
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_effective',
    label: 'License effective date',
    type: 'date',
    section: 'license',
    purpose: 'Confirms the license is currently active',
    authority: 'STATE_DEALER_BOARD',
    validation: isoDate,
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_expiry',
    label: 'License expiration date',
    type: 'date',
    section: 'license',
    purpose: 'We will remind you before it lapses so bidding never stops',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'Bidding is suspended automatically when a license expires.',
    validation: isoDate,
    derivableFrom: ['dealer_license'],
  }),
  defineField({
    id: 'license_country',
    label: 'License country',
    type: 'select',
    section: 'license',
    purpose: 'Which country’s board issued it, so we verify against the right one',
    authority: 'STATE_DEALER_BOARD',
    validation: z.string().min(2, 'Select the issuing country'),
    // No derivableFrom: the labelled anchor table holds no country label.
    orchestratorVisible: true,
  }),
  defineField({
    id: 'license_image',
    label: 'Photo of your license',
    type: 'file',
    section: 'license',
    purpose: 'A person on our team checks it against your state board record',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string().min(1)).min(1, 'Upload your license'),
  }),
]
