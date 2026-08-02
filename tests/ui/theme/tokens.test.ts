import { describe, it, expect } from 'vitest'
import { COLOR, STATUS_COLOR } from '@/ui/theme/tokens'

describe('theme tokens', () => {
  it('uses the measured IAA primary red', () => {
    expect(COLOR.primary).toBe('#B82018')
  })

  it('never uses red for errors — red is the brand', () => {
    expect(COLOR.error).toBe('#E87830')
    expect(COLOR.error).not.toBe(COLOR.primary)
  })

  it('reuses the existing success green for verified fields', () => {
    expect(COLOR.success).toBe('#408030')
    expect(STATUS_COLOR.verified).toBe(COLOR.success)
    expect(STATUS_COLOR.confirmed).toBe(COLOR.success)
  })

  it('gives derived fields a neutral, not a new hue', () => {
    expect(STATUS_COLOR.derived).toBe(COLOR.textMuted)
  })

  it('colours rejected fields with the warning orange', () => {
    expect(STATUS_COLOR.rejected).toBe(COLOR.error)
  })

  it('exposes every colour as a six-digit hex', () => {
    for (const [k, v] of Object.entries(COLOR)) {
      expect(v, k).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})
