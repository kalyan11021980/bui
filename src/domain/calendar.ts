/**
 * Calendar validity, not just shape: `1982-13-45` is the difference between
 * rejecting a typo'd date of birth and filing it with the IRS. Never reads
 * the clock — "is this in the past" is asked where dates are compared.
 *
 * Round-tripping catches what the ISO parser silently normalises, so
 * 2026-02-30 cannot slip through as 2026-03-02.
 *
 * Shared by the catalog's `isoDate` schema and every OCR date extractor —
 * neither owns it, so it lives at the domain root.
 */
export function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}
