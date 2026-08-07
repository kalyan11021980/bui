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
  defineField({
    id: 'poa_form',
    label: 'Power of attorney form',
    type: 'file',
    section: 'state_forms',
    purpose: 'Lets IAA sign sale documents on your behalf where a state requires it',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string().min(1)).min(1, 'Upload the completed form'),
  }),
  defineField({
    id: 'bid_card',
    label: 'State bid card',
    type: 'file',
    section: 'state_forms',
    purpose: 'Some states require a bid card before you can bid on their lots',
    authority: 'STATE_DEALER_BOARD',
    validation: z.array(z.string().min(1)).min(1, 'Upload your bid card'),
  }),
]
