import { describe, it, expect } from 'vitest'
import { PROFILE_BRIDGE, bridgeForField } from '@/domain/application/profile-bridge'
import { ALL_PROFILE_KEYS } from '@/domain/requirements/rules'

describe('PROFILE_BRIDGE', () => {
  it('covers every profile key', () => {
    const keys = PROFILE_BRIDGE.map((e) => e.key)
    for (const key of ALL_PROFILE_KEYS) expect(keys).toContain(key)
  })

  it('converts yes/no answers to booleans and back', () => {
    const entry = bridgeForField('wants_gsa')!
    expect(entry.toPatch('yes')).toEqual({ wantsGsa: true })
    expect(entry.toPatch('no')).toEqual({ wantsGsa: false })
    expect(entry.toFieldValue(true)).toBe('yes')
    expect(entry.toFieldValue(false)).toBe('no')
  })

  it('skips unanswerable patch values', () => {
    expect(bridgeForField('location_state')!.toFieldValue(null)).toBeNull()
    expect(bridgeForField('licenses_held')!.toFieldValue([])).toBeNull()
  })

  it('passes licence arrays through whole', () => {
    const entry = bridgeForField('licenses_held')!
    expect(entry.toPatch(['dealer', 'salvage'])).toEqual({ licenses: ['dealer', 'salvage'] })
    expect(entry.toFieldValue(['dealer'])).toEqual(['dealer'])
  })
})
