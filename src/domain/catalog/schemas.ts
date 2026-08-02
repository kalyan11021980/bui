import { z } from 'zod'

/**
 * Shape AND calendar validity. The format-only version accepted `1982-13-45`,
 * which never mattered while no schema was executed in production; the moment
 * the route began running catalog schemas it became the difference between
 * rejecting a typo'd date of birth and filing it with the IRS.
 *
 * Pure: it depends on the input string only, never on the current time. "Is
 * this date in the past / has this licence expired" is a separate question,
 * asked where dates are compared, with the timestamp passed in.
 */
function isRealCalendarDate(value: string): boolean {
  // Date's ISO parser rejects impossible days (2026-02-30, month 13) outright.
  // Round-tripping back to a string also catches anything it silently
  // normalises, so 2026-02-30 cannot slip through as 2026-03-02.
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
