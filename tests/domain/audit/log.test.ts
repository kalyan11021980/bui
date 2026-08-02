import { describe, it, expect } from 'vitest'
import { AuditLog, digest } from '@/domain/audit/log'

const AT = '2026-08-01T12:00:00.000Z'

describe('AuditLog', () => {
  it('assigns sequential numbers starting at 1', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    log.append({
      type: 'SET_VALUE', fieldId: 'last_name', value: 'Chatterjee',
      source: 'user', at: AT,
    })
    expect(log.entries().map((e) => e.seq)).toEqual([1, 2])
  })

  it('stores the plain value for a non-sensitive field', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(log.entries()[0]?.value).toBe('Kalyan')
    expect(log.entries()[0]?.valueDigest).toBeUndefined()
  })

  it('stores only a digest for a sensitive field', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'tax_id', value: '123-45-6789',
      source: 'user', at: AT,
    })
    const e = log.entries()[0]
    expect(e?.value).toBeUndefined()
    expect(e?.valueDigest).toBe(digest('123-45-6789'))
    expect(JSON.stringify(log.entries())).not.toContain('123-45-6789')
  })

  it('records the copy hash the user was shown when confirming', () => {
    const log = new AuditLog()
    log.append({
      type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'copy-v3',
    })
    expect(log.entries()[0]?.shownCopyHash).toBe('copy-v3')
    expect(log.entries()[0]?.kind).toBe('confirmed')
  })

  it('refuses to mutate an entry once appended', () => {
    const log = new AuditLog()
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    const entries = log.entries()
    expect(() => {
      ;(entries as unknown as { push: (x: unknown) => void }).push({})
    }).toThrow()
    expect(log.size()).toBe(1)
  })

  it('produces a stable digest', () => {
    expect(digest('abc')).toBe(digest('abc'))
    expect(digest('abc')).not.toBe(digest('abd'))
  })

  it('logs a rejection with its reason', () => {
    const log = new AuditLog()
    log.append({
      type: 'REJECT', fieldId: 'id_images', at: AT,
      reason: 'The photo was too dark',
    })
    expect(log.entries()[0]?.kind).toBe('rejected')
    expect(log.entries()[0]?.reason).toMatch(/too dark/)
  })

  it('starts empty', () => {
    expect(new AuditLog().size()).toBe(0)
    expect(new AuditLog().entries()).toEqual([])
  })
})
