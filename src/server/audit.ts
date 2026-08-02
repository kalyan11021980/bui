import { AuditLog } from '@/domain/audit/log'
import { createDigester } from '@/domain/audit/digest'

/**
 * Server-only. `createDigester` reaches into node:crypto, and this module
 * reads a secret out of the environment, so it must never be imported from a
 * 'use client' file — only from route handlers and other server code.
 *
 * (AuditLog itself does NOT touch node:crypto, an earlier version of this
 * comment notwithstanding: it imports `Digester` as a type only, which is
 * erased at compile time. The digester is handed to it.)
 *
 * The digest secret comes from AUDIT_DIGEST_SECRET. If it is missing we
 * refuse to start rather than silently digesting sensitive fields with a
 * guessable key — except in the two named modes below, where we fall back
 * to a fixed development-only string purely so `pnpm dev`/`pnpm build`/
 * `pnpm test` work without any local setup. That fallback is never
 * appropriate for real data.
 */
const DEV_ONLY_FALLBACK_SECRET = 'dev-only-fallback-audit-secret-do-not-use-in-prod'

/**
 * Allowlist, not blocklist: an unset, unexpected, or misspelled NODE_ENV
 * (custom server.js, a container that never sets it, a "staging" environment
 * that actually handles real applicant PII) must fail closed, not silently
 * fall through to a secret that is public in git history. Only these two
 * named modes may use the fallback.
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

let instance: AuditLog | undefined

/**
 * Lazily constructed. `next build` imports every route module to collect
 * page data — that import must not itself trip the production secret check,
 * or a correctly-configured production build would fail before a single
 * request is served. Deferring construction to first use means the check
 * only runs when a request actually needs the digester.
 *
 * In-memory for phase 1, same as store.ts: entries are lost on restart and
 * are not shared across processes. Swapped for durable storage in phase 4,
 * alongside the review queue that needs to read the trail from another
 * process.
 */
export function getAuditLog(): AuditLog {
  if (!instance) {
    instance = new AuditLog(createDigester(resolveSecret()))
  }
  return instance
}

/**
 * Test-only. Clears the singleton so the next getAuditLog() call rebuilds it
 * — needed because tests may want a fresh log (and a fresh digester keyed
 * off a test-specific AUDIT_DIGEST_SECRET) between cases. Never call this
 * from application code.
 */
export function __resetAuditLogForTests(): void {
  instance = undefined
}
