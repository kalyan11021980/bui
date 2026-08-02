import type { ApplicationState } from '@/domain/application/state'

/** TODO(phase-4): a real database, once the review queue reads from another process. */
const applications = new Map<string, ApplicationState>()

export function getApplication(id: string): ApplicationState | undefined {
  return applications.get(id)
}

export function putApplication(state: ApplicationState): void {
  applications.set(state.id, state)
}

/** Test-only. Empties the store so cases cannot leak into one another. */
export function __resetStoreForTests(): void {
  applications.clear()
}
