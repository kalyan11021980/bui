import type { FieldType } from '@/domain/field-def'

/**
 * Renders a stored value for display. Not `String(value)`: that collapses a
 * file list to `front.jpg,back.jpg` and any object to `[object Object]`, and
 * a value the applicant cannot read is one they confirm without checking.
 */
export function formatValue(value: unknown, type: FieldType): string {
  if (value === null || value === undefined) return ''

  if (Array.isArray(value)) {
    const parts = value.map(formatScalar).filter((p) => p !== '')
    if (parts.length === 0) return ''
    // Leading with the count answers "did both sides of my licence attach?"
    // without making the applicant count filenames.
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
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
