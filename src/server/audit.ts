import { AuditLog } from '@/domain/audit/log'
import { createDigester } from '@/domain/audit/digest'

/**
 * Server-only. AuditLog and createDigester both reach into node:crypto, so
 * this module must never be imported from a 'use client' file — only from
 * route handlers and other server code.
 *
 * The digest secret comes from AUDIT_DIGEST_SECRET. In production it MUST be
 * set to a real, non-default value (32+ chars) by the deploy environment; if
 * it is missing we refuse to start rather than silently digesting sensitive
 * fields with a guessable key. Outside production we fall back to a fixed
 * development-only string purely so `pnpm dev` and `pnpm build` work without
 * any local setup — that fallback is never appropriate for real data.
 */
const DEV_ONLY_FALLBACK_SECRET = 'dev-only-fallback-audit-secret-do-not-use-in-prod'

function resolveSecret(): string {
  const fromEnv = process.env.AUDIT_DIGEST_SECRET
  if (fromEnv) return fromEnv

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUDIT_DIGEST_SECRET must be set in production. Refusing to start with ' +
        'the development fallback secret, which would leave audit digests ' +
        'guessable.',
    )
  }

  return DEV_ONLY_FALLBACK_SECRET
}

let instance: AuditLog | undefined

/**
 * Lazily constructed. `next build` imports every route module to collect
 * page data — that import must not itself trip the production secret check,
 * or a correctly-configured production build would fail before a single
 * request is served. Deferring construction to first use means the check
 * only runs when a request actually needs the digester.
 */
export function getAuditLog(): AuditLog {
  if (!instance) {
    instance = new AuditLog(createDigester(resolveSecret()))
  }
  return instance
}
