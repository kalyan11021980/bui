import { createHmac, scryptSync } from 'node:crypto'

export type Digester = (input: string) => string

/**
 * A fixed, non-secret salt. scrypt's salt exists to stop precomputation being
 * shared across different deployments; it is not the secret. The secret is
 * the HMAC key below.
 */
const SCRYPT_SALT = 'iaa-audit-digest-v1'

/**
 * Keyed AND deliberately slow, in that order.
 *
 * 1. HMAC-SHA256 under the secret. Keying stops an attacker who has only the
 *    log: without the secret they cannot compute a candidate digest at all.
 * 2. scrypt over the HMAC output. Slowness stops an attacker who has BOTH the
 *    log and the secret, which matters because the inputs are low-entropy — a
 *    9-digit taxpayer ID or a date of birth is a small enough space to
 *    exhaust against a fast hash.
 *
 * The previous version passed the secret as scrypt's *salt* parameter. That
 * is keyed and it does work, but it is not what the salt parameter is for,
 * and a reader checking this against the scrypt spec has to stop and work out
 * whether it is a bug. Feeding scrypt an already-keyed input with a fixed
 * salt uses both primitives the way they are specified.
 *
 * KNOWN AND ACCEPTED: the digest is deterministic, so identical inputs
 * produce identical digests — the log therefore leaks EQUALITY across
 * applicants. Two applications sharing a taxpayer ID are visibly linked to
 * anyone holding the log. This is inherent to a per-value digest and is not
 * fixed by salting per entry, because a per-entry salt would also destroy the
 * only property that makes these digests useful: being able to show that the
 * value recorded at step 40 is the one the applicant confirmed at step 12.
 * Hiding equality needs a different construction (per-application keys, or
 * encryption under a recoverable key) plus a decision about what a compliance
 * reviewer is entitled to see. That is a phase-4 question, recorded here
 * rather than left implied.
 *
 * The secret is injected rather than read from the environment so the domain
 * layer stays pure and testable.
 */
export function createDigester(secret: string): Digester {
  if (secret.length < 32) {
    throw new Error('Audit digest secret must be at least 32 characters')
  }
  return (input) => {
    const keyed = createHmac('sha256', secret).update(input).digest()
    return scryptSync(keyed, SCRYPT_SALT, 32, { N: 16384, r: 8, p: 1 }).toString('hex')
  }
}
