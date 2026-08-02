import { describe, it, expect, afterEach } from 'vitest'
import { getAuditLog, __resetAuditLogForTests } from '@/server/audit'

// Next.js's global type augmentation declares `NODE_ENV` readonly, which is
// correct for application code but gets in the way of a test that needs to
// simulate every deploy mode. Reinterpreting through a plain mutable record
// is scoped to this file only — it doesn't loosen the type anywhere else.
const env = process.env as Record<string, string | undefined>

describe('audit secret resolution — allowlist, not blocklist', () => {
  const originalSecret = env.AUDIT_DIGEST_SECRET
  const originalNodeEnv = env.NODE_ENV

  afterEach(() => {
    if (originalSecret === undefined) delete env.AUDIT_DIGEST_SECRET
    else env.AUDIT_DIGEST_SECRET = originalSecret

    if (originalNodeEnv === undefined) delete env.NODE_ENV
    else env.NODE_ENV = originalNodeEnv

    __resetAuditLogForTests()
  })

  it('throws when NODE_ENV is unset and no secret is provided', () => {
    delete env.AUDIT_DIGEST_SECRET
    delete env.NODE_ENV
    __resetAuditLogForTests()

    expect(() => getAuditLog()).toThrow(/AUDIT_DIGEST_SECRET must be set/)
  })

  it('throws for an unexpected NODE_ENV (e.g. a staging deploy) rather than silently falling back', () => {
    delete env.AUDIT_DIGEST_SECRET
    env.NODE_ENV = 'staging'
    __resetAuditLogForTests()

    expect(() => getAuditLog()).toThrow(/AUDIT_DIGEST_SECRET must be set/)
  })

  it('still throws for the historically-checked "production" value', () => {
    delete env.AUDIT_DIGEST_SECRET
    env.NODE_ENV = 'production'
    __resetAuditLogForTests()

    expect(() => getAuditLog()).toThrow(/AUDIT_DIGEST_SECRET must be set/)
  })

  it('never leaks the secret value itself into the error message', () => {
    delete env.AUDIT_DIGEST_SECRET
    env.NODE_ENV = 'staging'
    __resetAuditLogForTests()

    expect(() => getAuditLog()).toThrow(/^(?!.*dev-only-fallback).*$/s)
  })

  it('falls back to the development secret only for development or test', () => {
    delete env.AUDIT_DIGEST_SECRET

    env.NODE_ENV = 'test'
    __resetAuditLogForTests()
    expect(() => getAuditLog()).not.toThrow()

    env.NODE_ENV = 'development'
    __resetAuditLogForTests()
    expect(() => getAuditLog()).not.toThrow()
  })

  it('always prefers an explicit AUDIT_DIGEST_SECRET, in any NODE_ENV', () => {
    env.AUDIT_DIGEST_SECRET = 'explicit-secret-32-chars-minimum!!!'
    env.NODE_ENV = 'staging'
    __resetAuditLogForTests()

    expect(() => getAuditLog()).not.toThrow()
  })
})
