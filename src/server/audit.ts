import { AuditLog } from '@/domain/audit/log'
import { createDigester } from '@/domain/audit/digest'

/**
 * Server-only: reads a secret from the environment and constructs a digester
 * over node:crypto. Never import this from a 'use client' file.
 */

/** Only so dev/build/test run without local setup. Never for real data. */
const DEV_ONLY_FALLBACK_SECRET = 'dev-only-fallback-audit-secret-do-not-use-in-prod'

/**
 * Allowlist, not blocklist: an unset or misspelled NODE_ENV must fail closed
 * rather than fall through to a secret that is public in git history.
 */
const ALLOW_FALLBACK = new Set(['development', 'test'])

function resolveSecret(): string {
  const fromEnv = process.env.AUDIT_DIGEST_SECRET
  if (fromEnv) return fromEnv

  const mode = process.env.NODE_ENV
  if (mode !== undefined && ALLOW_FALLBACK.has(mode)) {
    return DEV_ONLY_FALLBACK_SECRET
  }

  throw new Error(
    `AUDIT_DIGEST_SECRET must be set (NODE_ENV=${String(mode)}). ` +
      'The development fallback is only permitted when NODE_ENV is ' +
      'development or test.',
  )
}

type GlobalLog = typeof globalThis & { __buyersuiAuditLog?: AuditLog }

/**
 * Lazy, because `next build` imports every route module to collect page data
 * and that import must not trip the production secret check.
 *
 * On globalThis for the reason the store is: each route is bundled with its own
 * copy of this module, and one trail split across two of them is not a trail.
 *
 * TODO(phase-4): durable storage. In-memory, so entries are lost on restart
 * and not shared across processes.
 */
export function getAuditLog(): AuditLog {
  const existing = (globalThis as GlobalLog).__buyersuiAuditLog
  if (existing) return existing

  const created = new AuditLog(createDigester(resolveSecret()))
  ;(globalThis as GlobalLog).__buyersuiAuditLog = created
  return created
}

/** Test-only. Rebuilds the singleton on the next getAuditLog() call. */
export function __resetAuditLogForTests(): void {
  delete (globalThis as GlobalLog).__buyersuiAuditLog
}
