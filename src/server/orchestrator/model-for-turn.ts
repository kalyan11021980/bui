import type { LanguageModel } from 'ai'
import { readConfig, resolveModel } from './model'

/**
 * What a turn needs from the model: the client plus the config that decides
 * how `runTurn` calls it. Bundled together so a test override replaces both
 * at once, never a model paired with the wrong effort or provider.
 */
export type ModelForTurn = () => { model: LanguageModel; effort: string }

function defaultModelForTurn(): ReturnType<ModelForTurn> {
  const config = readConfig(process.env)
  return { model: resolveModel(process.env), effort: config.effort }
}

let current: ModelForTurn = defaultModelForTurn

/**
 * The turn route's only source for a model. A separate module, not a route
 * export: Next.js's route type-checking rejects any route export beyond the
 * HTTP verbs and its own config fields, so the override seam has to live
 * beside the route rather than in it.
 */
export function modelForTurn(): ReturnType<ModelForTurn> {
  return current()
}

/** Test-only seam: overrides the model (and its config) for the next turn(s). */
export function __setModelForTurnTests(fn: ModelForTurn | null): void {
  current = fn ?? defaultModelForTurn
}
