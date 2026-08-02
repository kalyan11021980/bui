import { scryptSync } from 'node:crypto'

export type Digester = (input: string) => string

/**
 * Keyed AND deliberately slow. Keying stops an attacker who has only the
 * log; slowness stops one who has the log and the secret, which matters
 * because the inputs are low-entropy — a 9-digit taxpayer ID or a date of
 * birth is a small enough space to exhaust against a fast hash.
 * The secret is injected rather than read from the environment so the
 * domain layer stays pure and testable.
 */
export function createDigester(secret: string): Digester {
  if (secret.length < 32) {
    throw new Error('Audit digest secret must be at least 32 characters')
  }
  return (input) =>
    scryptSync(input, secret, 32, { N: 16384, r: 8, p: 1 }).toString('hex')
}
