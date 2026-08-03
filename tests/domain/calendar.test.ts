import { describe, expect, it } from 'vitest'
import { isRealCalendarDate } from '@/domain/calendar'

describe('isRealCalendarDate', () => {
  it('accepts a real date', () => {
    for (const good of ['1982-08-31', '2000-02-29', '2026-12-31', '2026-01-01']) {
      expect(isRealCalendarDate(good), good).toBe(true)
    }
  })

  it('rejects an impossible calendar date', () => {
    for (const bad of ['1982-13-45', '2026-02-30', '2026-00-10', '2026-01-32', '2025-02-29']) {
      expect(isRealCalendarDate(bad), bad).toBe(false)
    }
  })

  it('never normalises a bad date into a neighbouring good one', () => {
    // Date's leniency in other parsing modes would turn 2026-02-30 into
    // 2026-03-02 — silently filing the wrong date.
    expect(isRealCalendarDate('2026-02-30')).toBe(false)
  })

  it('is pure — same input, same answer, independent of the clock', () => {
    expect(isRealCalendarDate('2026-08-01')).toBe(isRealCalendarDate('2026-08-01'))
    expect(isRealCalendarDate('2099-01-01')).toBe(true)
  })
})
