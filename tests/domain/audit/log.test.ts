import { describe, it, expect } from 'vitest'
import { AuditLog } from '@/domain/audit/log'
import { createDigester } from '@/domain/audit/digest'

const AT = '2026-08-01T12:00:00.000Z'
const TEST_SECRET = 'test-secret-at-least-32-characters-long'
const digester = createDigester(TEST_SECRET)

describe('AuditLog', () => {
  it('assigns sequential numbers starting at 1', () => {
    const log = new AuditLog(digester)
    log.append('app-1', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    log.append('app-1', {
      type: 'SET_VALUE', fieldId: 'last_name', value: 'Chatterjee',
      source: 'user', at: AT,
    })
    expect(log.entries().map((e) => e.seq)).toEqual([1, 2])
  })

  it('stores the plain value for a non-sensitive field', () => {
    const log = new AuditLog(digester)
    log.append('app-1', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(log.entries()[0]?.value).toBe('Kalyan')
    expect(log.entries()[0]?.valueDigest).toBeUndefined()
  })

  it('stores only a digest for a sensitive field', () => {
    const log = new AuditLog(digester)
    log.append('app-1', {
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
    log.append('app-1', {
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
      log.append('app-1', {
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
    log.append('app-1', {
      type: 'CONFIRM', fieldId: 'dob', at: AT, shownCopyHash: 'copy-v3',
    })
    expect(log.entries()[0]?.shownCopyHash).toBe('copy-v3')
    expect(log.entries()[0]?.kind).toBe('confirmed')
  })

  it('refuses to mutate the entries array once appended', () => {
    const log = new AuditLog(digester)
    log.append('app-1', {
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
    log.append('app-1', {
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

  it('two different secrets produce different digests for the same input', () => {
    const a = createDigester('secret-one-at-least-32-characters-long')
    const b = createDigester('secret-two-at-least-32-characters-long')
    expect(a('123-45-6789')).not.toBe(b('123-45-6789'))
  })

  it('does not reveal the input in the digest', () => {
    expect(digester('123-45-6789')).not.toContain('123')
    expect(digester('123-45-6789')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('digests identical inputs identically — a known, documented equality leak', () => {
    // Deliberate, and the reason the digest is deterministic at all: a
    // reviewer must be able to show that the value confirmed at one step is
    // the value recorded at another. The cost is that two applicants sharing
    // a taxpayer ID are visibly linked to anyone holding the log. Asserted
    // here so the trade-off is visible rather than merely true.
    expect(digester('123-45-6789')).toBe(digester('123-45-6789'))
  })

  it('logs a rejection with its reason', () => {
    const log = new AuditLog(digester)
    log.append('app-1', {
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

describe('AuditLog — profile changes record WHAT changed', () => {
  it('captures the patch, not just that a profile was updated', () => {
    // The event used to be exactly {"seq":1,"kind":"profile_updated"} — which
    // reconstructs nothing. The profile is the only input to the requirements
    // engine, so these are the changes that move an applicant's obligations.
    const log = new AuditLog(digester)
    const e = log.append('app-1', {
      type: 'UPDATE_PROFILE',
      patch: { applicantType: 'business', state: 'OH', licenses: ['dealer'] },
      at: AT,
    })
    expect(e.kind).toBe('profile_updated')
    expect(e.patch).toEqual({
      applicantType: 'business', state: 'OH', licenses: ['dealer'],
    })
  })

  it('records only the keys that were actually sent', () => {
    const log = new AuditLog(digester)
    const e = log.append('app-1', { type: 'UPDATE_PROFILE', patch: { wantsGsa: true }, at: AT })
    expect(Object.keys(e.patch ?? {})).toEqual(['wantsGsa'])
  })

  it('records a licence list being emptied, which removes requirements', () => {
    const log = new AuditLog(digester)
    const e = log.append('app-1', { type: 'UPDATE_PROFILE', patch: { licenses: [] }, at: AT })
    expect(e.patch?.licenses).toEqual([])
  })

  it('copies the patch rather than holding the caller\'s object', () => {
    const log = new AuditLog(digester)
    const patch = { wantsGsa: true }
    log.append('app-1', { type: 'UPDATE_PROFILE', patch, at: AT })
    patch.wantsGsa = false
    expect(log.entriesFor('app-1')[0]?.patch).toEqual({ wantsGsa: true })
  })

  it('leaves patch absent on every other kind of event', () => {
    const log = new AuditLog(digester)
    log.append('app-1', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada', source: 'user', at: AT,
    })
    expect(log.entriesFor('app-1')[0]?.patch).toBeUndefined()
  })
})

describe('AuditLog — the sensitive-value boundary fails CLOSED', () => {
  it('refuses to append a SET_VALUE for a field id the catalog does not know', () => {
    // The bug: `CATALOG.get(...)` missed, `def?.sensitive` was falsy, and the
    // code took the RAW-VALUE branch. A one-character typo in a sensitive
    // field id therefore wrote a plaintext SSN into the log. An unknown id is
    // not evidence that a value is safe to store in the clear.
    const log = new AuditLog(digester)
    expect(() =>
      log.append('app-1', {
        type: 'SET_VALUE', fieldId: 'tax_id_typo', value: '123-45-6789',
        source: 'user', at: AT,
      }),
    ).toThrow(/unknown field/i)
  })

  it('leaves no trace of the value when it refuses', () => {
    const log = new AuditLog(digester)
    try {
      log.append('app-1', {
        type: 'SET_VALUE', fieldId: 'tax_id_typo', value: '123-45-6789',
        source: 'user', at: AT,
      })
    } catch {
      // expected
    }
    expect(log.size()).toBe(0)
    expect(JSON.stringify(log.entries())).not.toContain('123-45-6789')
  })

  it('refuses an unknown field id on every action type, not just SET_VALUE', () => {
    const log = new AuditLog(digester)
    expect(() =>
      log.append('app-1', { type: 'CONFIRM', fieldId: 'not_a_field', at: AT, shownCopyHash: 'c' }),
    ).toThrow(/unknown field/i)
    expect(() =>
      log.append('app-1', { type: 'REJECT', fieldId: 'not_a_field', at: AT, reason: 'r' }),
    ).toThrow(/unknown field/i)
    expect(log.size()).toBe(0)
  })

  it('refuses a malformed requirement key rather than logging it', () => {
    const log = new AuditLog(digester)
    expect(() =>
      log.append('app-1', {
        type: 'SET_VALUE', fieldId: 'tax_id#abc', value: '123-45-6789',
        source: 'user', at: AT,
      }),
    ).toThrow()
    expect(JSON.stringify(log.entries())).not.toContain('123-45-6789')
  })
})

describe('AuditLog — per-application trails', () => {
  it('stamps every event with the application it belongs to', () => {
    const log = new AuditLog(digester)
    const e = log.append('app-7', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada',
      source: 'user', at: AT,
    })
    expect(e.applicationId).toBe('app-7')
  })

  it('keeps two applications apart instead of interleaving one shared sequence', () => {
    // The exact failure this guards: two applications, one event each,
    // producing seq 1 and seq 2 in a single undiscriminated stream that
    // cannot be split back apart.
    const log = new AuditLog(digester)
    log.append('app-a', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada',
      source: 'user', at: AT,
    })
    log.append('app-b', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Bob',
      source: 'user', at: AT,
    })

    const a = log.entriesFor('app-a')
    const b = log.entriesFor('app-b')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]?.seq).toBe(1)
    expect(b[0]?.seq).toBe(1)
    expect(a[0]?.value).toBe('Ada')
    expect(b[0]?.value).toBe('Bob')
    // Nothing from B may appear in A's trail — this is what a compliance
    // reviewer is handed.
    expect(JSON.stringify(a)).not.toContain('Bob')
  })

  it('numbers seq per application, 1..n', () => {
    const log = new AuditLog(digester)
    for (const name of ['Ada', 'Grace', 'Alan']) {
      log.append('app-a', {
        type: 'SET_VALUE', fieldId: 'first_name', value: name,
        source: 'user', at: AT,
      })
    }
    log.append('app-b', {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Bob',
      source: 'user', at: AT,
    })
    expect(log.entriesFor('app-a').map((e) => e.seq)).toEqual([1, 2, 3])
    expect(log.entriesFor('app-b').map((e) => e.seq)).toEqual([1])
    expect(log.sizeFor('app-a')).toBe(3)
    expect(log.size()).toBe(4)
  })

  it('returns an empty trail for an application with no events', () => {
    expect(new AuditLog(digester).entriesFor('never-seen')).toEqual([])
    expect(new AuditLog(digester).sizeFor('never-seen')).toBe(0)
  })

  it('refuses an event that names no application', () => {
    const log = new AuditLog(digester)
    expect(() =>
      log.append('', {
        type: 'SET_VALUE', fieldId: 'first_name', value: 'Ada',
        source: 'user', at: AT,
      }),
    ).toThrow(/name the application/i)
  })
})
