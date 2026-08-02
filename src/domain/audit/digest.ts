import { createHmac } from 'node:crypto'

/** Digests a value for the audit log without storing it. */
export type Digester = (input: string) => string

/**
 * Keyed so a digest cannot be brute-forced back to its input. Low-entropy
 * values — a 9-digit taxpayer ID, a date of birth — are otherwise trivially
 * recoverable from an unkeyed hash by anyone who can read the audit store.
 */
export function createDigester(secret: string): Digester {
  if (secret.length < 32) {
    throw new Error('Audit digest secret must be at least 32 characters')
  }
  return (input) => createHmac('sha256', secret).update(input).digest('hex')
}
