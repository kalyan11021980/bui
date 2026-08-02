import type { FieldType } from '@/domain/field-def'

/**
 * Renders a stored value for display.
 *
 * `String(value)` is lossy in exactly the ways this data model produces:
 * `['front.jpg', 'back.jpg']` collapses to `front.jpg,back.jpg` with no gap
 * to read, and any object becomes `[object Object]` — a value the applicant
 * cannot read is a value they will confirm without checking. The identical
 * finding was fixed on the audit log in Task 7 and not carried across to the
 * panel.
 */
export function formatValue(value: unknown, type: FieldType): string {
  if (value === null || value === undefined) return ''

  if (Array.isArray(value)) {
    const parts = value.map(formatScalar).filter((p) => p !== '')
    if (parts.length === 0) return ''
    // File fields hold a list of names in phase 1 (there is no upload yet), so
    // this is the common case rather than an edge one. Leading with the count
    // answers "did both sides of my licence actually attach?" without making
    // the applicant count filenames.
    if (type === 'file' && parts.length > 1) {
      return `${parts.length} files: ${parts.join(', ')}`
    }
    return parts.join(', ')
  }

  return formatScalar(value)
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  // Never `[object Object]`. Showing the actual structure is ugly and honest;
  // showing a placeholder that hides it is neither.
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
