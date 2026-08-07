import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'
import { ID_COUNTRIES, US_STATES, countrySchema, usStateSchema } from './geography'

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

/**
 * The determinants: each is bridged to an ApplicantProfile key, so answering
 * one reshapes what the rest of the application asks.
 */
export const PROFILE_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'applicant_type',
    label: 'What best describes you?',
    type: 'select',
    options: [
      { value: 'business', label: 'Business with business license(s)' },
      { value: 'individual', label: 'Individual without business license(s)' },
    ],
    section: 'profile',
    purpose: 'Decides which questions the rest of the application asks',
    authority: 'IAA_POLICY',
    validation: z.enum(['business', 'individual']),
    orchestratorVisible: true,
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'location_country',
    label: 'Where are you located?',
    type: 'select',
    options: ID_COUNTRIES,
    section: 'profile',
    purpose: 'Registration requirements differ by country',
    authority: 'IAA_POLICY',
    validation: countrySchema,
    orchestratorVisible: true,
  }),
  defineField({
    id: 'location_state',
    label: 'Your state',
    type: 'select',
    options: US_STATES,
    section: 'profile',
    purpose: 'Some states require extra forms before you can bid',
    authority: 'STATE_DEALER_BOARD',
    validation: usStateSchema,
    orchestratorVisible: true,
  }),
  defineField({
    id: 'id_form',
    label: 'Which ID will you use?',
    type: 'select',
    options: [
      { value: 'drivers_license', label: "Driver's license" },
      { value: 'state_id', label: 'State ID' },
      { value: 'passport', label: 'Passport' },
    ],
    section: 'profile',
    purpose: 'Decides which document we read and which number we ask for',
    authority: 'FEDERAL_KYC',
    validation: z.enum(['drivers_license', 'state_id', 'passport']),
    orchestratorVisible: true,
  }),
  defineField({
    id: 'address_differs',
    label: 'Is your address different from the one on your ID?',
    type: 'select',
    options: YES_NO,
    section: 'profile',
    purpose: 'An address that does not match your ID needs separate proof',
    authority: 'FEDERAL_KYC',
    consequence: 'A utility bill, lease or mortgage statement covers the difference.',
    validation: z.enum(['yes', 'no']),
    orchestratorVisible: true,
  }),
  defineField({
    id: 'licenses_held',
    label: 'Which business licenses do you hold?',
    type: 'multiselect',
    options: [
      { value: 'dealer', label: 'Dealer' },
      { value: 'dismantler', label: 'Dismantler' },
      { value: 'exporter', label: 'Exporter' },
      { value: 'salvage', label: 'Salvage' },
    ],
    section: 'profile',
    purpose: 'Each license unlocks different vehicle categories',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'A business registration needs at least one. If you hold none, register as an individual.',
    validation: z
      .array(z.enum(['dealer', 'dismantler', 'exporter', 'salvage']))
      .min(1, 'Select at least one license'),
    orchestratorVisible: true,
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'wants_gsa',
    label: 'Do you want to bid on GSA government vehicles?',
    type: 'select',
    options: YES_NO,
    section: 'profile',
    purpose: 'Linking a GSA Fleet account unlocks government lots',
    authority: 'GSA',
    consequence: 'Skip this and you simply will not see GSA lots.',
    validation: z.enum(['yes', 'no']),
    orchestratorVisible: true,
  }),
]
