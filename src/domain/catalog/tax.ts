import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const TAX_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'tax_id',
    label: 'Taxpayer ID (SSN or EIN)',
    type: 'taxid',
    section: 'tax',
    purpose: 'So we can pay you when a vehicle you consign sells',
    authority: 'IRS',
    consequence:
      'The IRS requires a taxpayer ID on Form W-9. Without one, backup withholding may apply to your proceeds.',
    handling:
      'Encrypted at rest, masked in our systems, and never shown to other bidders.',
    destination: 'W-9, Part I',
    validation: z
      .string()
      .regex(/^(\d{3}-?\d{2}-?\d{4}|\d{2}-?\d{7})$/, 'Enter an SSN or EIN'),
    sensitive: true,
    neverBulkConfirm: true,
  }),
  defineField({
    id: 'tax_classification',
    label: 'Federal tax classification',
    type: 'select',
    options: [
      { value: 'individual_sole_proprietor', label: 'Individual / sole proprietor or single-member LLC' },
      { value: 'c_corporation', label: 'C corporation' },
      { value: 's_corporation', label: 'S corporation' },
      { value: 'partnership', label: 'Partnership' },
      { value: 'trust_estate', label: 'Trust / estate' },
      { value: 'llc', label: 'Limited liability company' },
      { value: 'other', label: 'Other' },
    ],
    section: 'tax',
    purpose: 'The IRS asks how your business is classified for tax purposes',
    authority: 'IRS',
    destination: 'W-9, line 3',
    validation: z.enum([
      'individual_sole_proprietor', 'c_corporation', 's_corporation',
      'partnership', 'trust_estate', 'llc', 'other',
    ]),
  }),
  defineField({
    // Deliberately not `sensitive`: the value is a name already held openly
    // in first_name/last_name, and this field is not orchestratorVisible, so
    // it never reaches the model anyway.
    id: 'tax_certification',
    label: 'W-9 certification',
    type: 'attest',
    attestation: 'w9_certification',
    section: 'tax',
    purpose: 'The IRS requires you to certify the taxpayer information you gave us',
    authority: 'IRS',
    destination: 'W-9, Part II',
    handling: 'Stored with your application and never shown to other bidders.',
    validation: z.string().min(1, 'Type your full name to certify'),
    neverBulkConfirm: true,
  }),
]
