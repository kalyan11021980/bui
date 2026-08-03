import type { ApplicationState } from '@/domain/application/state'

/**
 * TODO(phase-4): a real database, once the review queue reads from another process.
 *
 * Held on globalThis rather than in a module variable: Next compiles each route
 * into its own bundle, each with its own copy of this module. A plain Map gave
 * every route a private store, so an application created through one route was
 * unknown to the next — which no in-process test can see, because vitest loads
 * this file once.
 */
type GlobalStore = typeof globalThis & {
  __buyersuiApplications?: Map<string, ApplicationState>
}

/**
 * Read through on every call, never captured in a module variable: a captured
 * copy and the global can diverge the moment anything replaces the global.
 */
function applications(): Map<string, ApplicationState> {
  const existing = (globalThis as GlobalStore).__buyersuiApplications
  if (existing) return existing

  const created = new Map<string, ApplicationState>()
  ;(globalThis as GlobalStore).__buyersuiApplications = created
  return created
}

export function getApplication(id: string): ApplicationState | undefined {
  return applications().get(id)
}

export function putApplication(state: ApplicationState): void {
  applications().set(state.id, state)
}

/** Test-only. Empties the store so cases cannot leak into one another. */
export function __resetStoreForTests(): void {
  delete (globalThis as GlobalStore).__buyersuiApplications
}
