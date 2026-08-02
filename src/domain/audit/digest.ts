import { createHmac, scryptSync } from 'node:crypto'

export type Digester = (input: string) => string

/** Not the secret — the HMAC key is. scrypt's salt only scopes precomputation. */
const SCRYPT_SALT = 'iaa-audit-digest-v1'

/**
 * HMAC-SHA256 under the secret, then scrypt over that output. Keying stops an
 * attacker holding only the log; the slow hash stops one holding the log and
 * the secret, which matters because a 9-digit taxpayer ID or a date of birth
 * is a small enough space to exhaust against a fast hash.
 *
 * KNOWN AND ACCEPTED: the digest is deterministic, so the log leaks EQUALITY —
 * two applications sharing a taxpayer ID are visibly linked to anyone holding
 * it. Per-entry salting would fix that and destroy the property that makes
 * these digests useful (showing the value at step 40 is the one confirmed at
 * step 12). Hiding equality needs a different construction; phase-4 question.
 *
 * The secret is injected so the domain layer stays pure.
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
