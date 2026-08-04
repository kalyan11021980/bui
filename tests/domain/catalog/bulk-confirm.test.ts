import { describe, it, expect } from 'vitest'
import { fieldDef } from '@/domain/catalog'

/**
 * There is no bulk-confirm affordance today — confirmation is per-row. This
 * pins the flag so that when one is built it cannot include these three.
 */
describe('fields that may never be bulk-confirmed', () => {
  const NEVER = ['addr_line1', 'addr_city', 'addr_state', 'addr_zip',
                 'first_name', 'last_name', 'tax_id'] as const

  it.each(NEVER)('%s is marked neverBulkConfirm', (id) => {
    expect(fieldDef(id).neverBulkConfirm).toBe(true)
  })

  it('does not mark every field this way — the flag names an exception, not the default', () => {
    expect(fieldDef('dl_number').neverBulkConfirm).not.toBe(true)
  })
})
