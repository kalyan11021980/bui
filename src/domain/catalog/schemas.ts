import { z } from 'zod'

/**
 * Calendar validity, not just shape: `1982-13-45` is the difference between
 * rejecting a typo'd date of birth and filing it with the IRS. Never reads
 * the clock — "is this in the past" is asked where dates are compared.
 *
 * Round-tripping catches what the ISO parser silently normalises, so
 * 2026-02-30 cannot slip through as 2026-03-02.
 */
export function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isRealCalendarDate, 'That is not a real date')

export const zipSchema = z
  .string()
  .regex(/^\d{5}(-\d{4})?$/, 'Enter a 5-digit ZIP code')

export const phoneSchema = z
  .string()
  .regex(/^\+?1?\d{10}$/, 'Enter a 10-digit phone number')
