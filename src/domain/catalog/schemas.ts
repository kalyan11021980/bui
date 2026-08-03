import { z } from 'zod'
import { isRealCalendarDate } from '../calendar'

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
