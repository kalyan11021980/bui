import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

/** An entry here does nothing until STATE_RULES in requirements/rules.ts references it. */
export const STATE_FORM_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'oh_foreign_buyer_form',
    label: 'Ohio out-of-state buyer form',
    type: 'file',
    section: 'state_forms',
    purpose: 'Ohio requires this before an out-of-state dealer can bid there',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'Without it your bids on Ohio lots will be rejected.',
    validation: z.array(z.string().min(1)).min(1, 'Upload the completed form'),
  }),
]
