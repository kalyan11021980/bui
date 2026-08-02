import { describe, it, expect } from 'vitest'
import { ALL_FIELD_IDS } from '@/domain/field-id'
import { CATALOG, ALL_FIELDS } from '@/domain/catalog'

/**
 * Five ids sat in the FieldId union for the whole of phase 1 with no catalog
 * entry behind them — `primary_activity` and `preferred_language` among them,
 * both live and required in the real registration. Nothing caught it because
 * a type union cannot be enumerated at runtime. ALL_FIELD_IDS can.
 */
describe('catalog covers every declared field id', () => {
  it('has a definition for every id in ALL_FIELD_IDS', () => {
    const missing = ALL_FIELD_IDS.filter((id) => !CATALOG.has(id))
    expect(missing, `declared but not defined: ${missing.join(', ')}`).toEqual([])
  })

  it('declares every id the catalog defines', () => {
    const declared = new Set<string>(ALL_FIELD_IDS)
    const undeclared = ALL_FIELDS.map((f) => f.id).filter((id) => !declared.has(id))
    expect(undeclared, `defined but not declared: ${undeclared.join(', ')}`).toEqual([])
  })

  it('lists each id exactly once', () => {
    expect(new Set(ALL_FIELD_IDS).size).toBe(ALL_FIELD_IDS.length)
  })
})
