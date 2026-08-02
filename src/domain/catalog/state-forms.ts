import { z } from 'zod'
import { defineField, type FieldDef } from '../field-def'

/**
 * Forms required by one state and not others. Adding an entry here is not
 * enough — it must also be referenced from STATE_RULES in requirements/rules.ts.
 */
export const STATE_FORM_FIELDS: readonly FieldDef[] = [
  defineField({
    id: 'oh_foreign_buyer_form',
    label: 'Ohio out-of-state buyer form',
    type: 'file',
    purpose: 'Ohio requires this before an out-of-state dealer can bid there',
    authority: 'STATE_DEALER_BOARD',
    consequence: 'Without it your bids on Ohio lots will be rejected.',
    validation: z.array(z.string().min(1)).min(1, 'Upload the completed form'),
  }),
]
