import { describe, it, expect } from 'vitest'
import { reqKey, parseReqKey } from '@/domain/requirements/key'

describe('requirement keys', () => {
  it('leaves a non-repeated field id unqualified', () => {
    expect(reqKey('first_name')).toBe('first_name')
    expect(parseReqKey('first_name')).toEqual({
      fieldId: 'first_name', instance: null,
    })
  })

  it('qualifies a repeated field with its instance', () => {
    expect(reqKey('license_number', 0)).toBe('license_number#0')
    expect(reqKey('license_number', 1)).toBe('license_number#1')
  })

  it('round-trips an instance key', () => {
    expect(parseReqKey(reqKey('license_number', 2))).toEqual({
      fieldId: 'license_number', instance: 2,
    })
  })

  it('rejects a negative or non-integer instance', () => {
    expect(() => reqKey('license_number', -1)).toThrow(/instance/i)
    expect(() => reqKey('license_number', 1.5)).toThrow(/instance/i)
  })

  it('rejects a malformed key', () => {
    expect(() => parseReqKey('license_number#')).toThrow(/malformed/i)
    expect(() => parseReqKey('license_number#x')).toThrow(/malformed/i)
  })
})
