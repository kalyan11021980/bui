import type { FieldStatus } from '@/domain/application/state'

/**
 * Sampled from the existing IAA screens. RED IS THE BRAND, so red must never
 * signal an error — `error` is orange. Component libraries default
 * `destructive` to red; override it.
 */
export const COLOR = Object.freeze({
  primary: '#B82018',
  primaryDisabled: '#E0B0B0',
  success: '#408030',
  successSurface: '#E0E8D8',
  error: '#E87830',
  errorSurface: '#F8E8D8',
  textPrimary: '#202020',
  textSecondary: '#404040',
  textMuted: '#A8A8A8',
  border: '#C8C8C8',
  divider: '#E0E0E0',
  page: '#FAF9F7',
  surface: '#FFFFFF',
})

/** `derived` is neutral by design — that state is carried by texture (a dashed rule). */
export const STATUS_COLOR: Record<FieldStatus, string> = {
  empty: COLOR.textMuted,
  derived: COLOR.textMuted,
  confirmed: COLOR.success,
  verified: COLOR.success,
  rejected: COLOR.error,
  superseded: COLOR.textMuted,
}
