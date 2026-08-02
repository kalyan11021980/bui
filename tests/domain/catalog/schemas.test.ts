import { describe, it, expect } from 'vitest'
import { isoDate, phoneSchema, zipSchema } from '@/domain/catalog/schemas'

describe('isoDate', () => {
  it('accepts a real date', () => {
    for (const good of ['1982-08-31', '2000-02-29', '2026-12-31', '2026-01-01']) {
      expect(isoDate.safeParse(good).success, good).toBe(true)
    }
  })

  it('rejects an impossible calendar date that the format regex alone allowed', () => {
    // These all matched /^\d{4}-\d{2}-\d{2}$/ and parsed cleanly until the
    // route started running catalog schemas for real.
    for (const bad of ['1982-13-45', '2026-02-30', '2026-00-10', '2026-01-32', '2025-02-29']) {
      expect(isoDate.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('rejects the wrong shape entirely', () => {
    for (const bad of ['31-08-1982', '1982/08/31', '1982-8-31', '', 'yesterday']) {
      expect(isoDate.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('never normalises a bad date into a neighbouring good one', () => {
    // Date's leniency in other parsing modes would turn 2026-02-30 into
    // 2026-03-02 — silently filing the wrong date of birth.
    const result = isoDate.safeParse('2026-02-30')
    expect(result.success).toBe(false)
  })

  it('is pure — same input, same answer, independent of the clock', () => {
    expect(isoDate.safeParse('2026-08-01').success)
      .toBe(isoDate.safeParse('2026-08-01').success)
    // A future date is a valid date. Expiry is a comparison made elsewhere,
    // with the timestamp passed in.
    expect(isoDate.safeParse('2099-01-01').success).toBe(true)
  })
})

describe('zipSchema and phoneSchema', () => {
  it('accepts five and nine digit ZIPs', () => {
    expect(zipSchema.safeParse('30301').success).toBe(true)
    expect(zipSchema.safeParse('30301-1234').success).toBe(true)
    expect(zipSchema.safeParse('3030').success).toBe(false)
  })

  it('accepts a ten digit phone number', () => {
    expect(phoneSchema.safeParse('4045551234').success).toBe(true)
    expect(phoneSchema.safeParse('555').success).toBe(false)
  })
})
