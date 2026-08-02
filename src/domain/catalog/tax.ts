import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

export const TAX_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'tax_id',
    label: 'Taxpayer ID (SSN or EIN)',
    type: 'taxid',
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
  }),
]
