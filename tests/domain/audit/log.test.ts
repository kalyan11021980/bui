import { describe, it, expect } from 'vitest'
import { AuditLog } from '@/domain/audit/log'
import { createDigester } from '@/domain/audit/digest'

const AT = '2026-08-01T12:00:00.000Z'
const TEST_SECRET = 'test-secret-at-least-32-characters-long'
const digester = createDigester(TEST_SECRET)

describe('AuditLog', () => {
  it('assigns sequential numbers starting at 1', () => {
    const log = new AuditLog(digester)
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
    const log = new AuditLog(digester)
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(log.entries()[0]?.value).toBe('Kalyan')
    expect(log.entries()[0]?.valueDigest).toBeUndefined()
  })

  it('stores only a digest for a sensitive field', () => {
    const log = new AuditLog(digester)
    log.append({
      type: 'SET_VALUE', fieldId: 'tax_id', value: '123-45-6789',
      source: 'user', at: AT,
    })
    const e = log.entries()[0]
    expect(e?.value).toBeUndefined()
    expect(e?.valueDigest).toBe(digester(JSON.stringify('123-45-6789')))
    expect(JSON.stringify(log.entries())).not.toContain('123-45-6789')
  })

  it('stores only a digest for a sensitive field addressed by a licence-instance key', () => {
    // Guards against a regression where parseReqKey is skipped: CATALOG.get
    // would then be called with the raw `tax_id#0` key, miss, and def?.sensitive
    // would be falsy — silently storing the raw taxpayer ID in the clear.
    const log = new AuditLog(digester)
    log.append({
      type: 'SET_VALUE', fieldId: 'tax_id#0', value: '999-99-9999',
      source: 'user', at: AT,
    })
    const e = log.entries()[0]
    expect(e?.value).toBeUndefined()
    expect(e?.valueDigest).toBe(digester(JSON.stringify('999-99-9999')))
    expect(JSON.stringify(log.entries())).not.toContain('999-99-9999')
  })

  it('never stores a raw value for any sensitive field in the catalog', () => {
    const cases: Array<{ fieldId: string; value: unknown }> = [
      { fieldId: 'dl_number', value: 'D1234567' },
      { fieldId: 'dob', value: '1990-01-15' },
      { fieldId: 'id_images', value: ['front-scan-secret.jpg', 'back-scan-secret.jpg'] },
      { fieldId: 'tax_id', value: '123-45-6789' },
      { fieldId: 'tax_id#0', value: '999-99-9999' },
    ]
    for (const { fieldId, value } of cases) {
      const log = new AuditLog(digester)
      log.append({
        type: 'SET_VALUE', fieldId, value, source: 'user', at: AT,
      })
      const e = log.entries()[0]
      expect(e?.value, `${fieldId} must not carry a raw value`).toBeUndefined()
      expect(e?.valueDigest, `${fieldId} must carry a digest`).toBeDefined()
      const serialized = JSON.stringify(log.entries())
      for (const needle of Array.isArray(value) ? value : [value]) {
        expect(serialized, `${fieldId} raw value leaked into the log`).not.toContain(String(needle))
      }
    }
  })

  it('records the copy hash the user was shown when confirming', () => {
    const log = new AuditLog(digester)
    log.append({
      type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'copy-v3',
    })
    expect(log.entries()[0]?.shownCopyHash).toBe('copy-v3')
    expect(log.entries()[0]?.kind).toBe('confirmed')
  })

  it('refuses to mutate the entries array once appended', () => {
    const log = new AuditLog(digester)
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

  it('refuses to mutate a single entry once appended', () => {
    const log = new AuditLog(digester)
    log.append({
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    const entry = log.entries()[0]
    expect(entry).toBeDefined()
    expect(Object.isFrozen(entry)).toBe(true)
    expect(() => {
      ;(entry as { value: unknown }).value = 'TAMPERED'
    }).toThrow()
    // Internal state must be unaffected even if the throw above were somehow
    // swallowed by a caller — re-fetch and confirm it still reports the
    // original value.
    expect(log.entries()[0]?.value).toBe('Kalyan')
  })

  it('produces a stable digest for the same input and a different one for a similar input', () => {
    expect(digester('abc')).toBe(digester('abc'))
    expect(digester('abc')).not.toBe(digester('abd'))
  })

  it('rejects a digest secret shorter than 32 characters', () => {
    expect(() => createDigester('too-short')).toThrow()
  })

  it('logs a rejection with its reason', () => {
    const log = new AuditLog(digester)
    log.append({
      type: 'REJECT', fieldId: 'id_images', at: AT,
      reason: 'The photo was too dark',
    })
    expect(log.entries()[0]?.kind).toBe('rejected')
    expect(log.entries()[0]?.reason).toMatch(/too dark/)
  })

  it('starts empty', () => {
    expect(new AuditLog(digester).size()).toBe(0)
    expect(new AuditLog(digester).entries()).toEqual([])
  })
})
