import { NextResponse } from 'next/server'

/**
 * 400 malformed, 404 unknown, 409 submitted, 422 well-formed but not allowed.
 *
 * 409 and 422 are the pair that matters: 422 invites the caller to retry with
 * a better value, 409 says the state moved on and no value will be accepted.
 */
const STATUS = {
  malformed: 400,
  unknown: 404,
  submitted: 409,
  rejected: 422,
} as const

export type FailureKind = keyof typeof STATUS

export type Failure = { kind: FailureKind; message: string }

export function failure(kind: FailureKind, message: string): Failure {
  return { kind, message }
}

export function jsonError({ kind, message }: Failure) {
  return NextResponse.json({ error: message }, { status: STATUS[kind] })
}
