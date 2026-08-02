import type { ApplicationState } from '@/domain/application/state'

/**
 * In-memory for phase 1. Swapped for a real database in phase 4, when the
 * review queue needs to read applications from another process.
 */
const applications = new Map<string, ApplicationState>()

export function getApplication(id: string): ApplicationState | undefined {
  return applications.get(id)
}

export function putApplication(state: ApplicationState): void {
  applications.set(state.id, state)
}

/**
 * Test-only. Empties the in-memory store so cases cannot leak applications
 * into one another. Named to match `__resetAuditLogForTests`: the two are the
 * only test-only exports on the server, and a reader should not have to open
 * both to discover that the plainly-named one was also test-only. Never call
 * this from application code.
 */
export function __resetStoreForTests(): void {
  applications.clear()
}
