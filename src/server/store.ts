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

export function resetStore(): void {
  applications.clear()
}
