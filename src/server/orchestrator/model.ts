import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export type OrchestratorConfig = {
  modelId: string
  endpoint: string
  effort: string
  /** Absent for a keyless local server (LM Studio); required by hosted ones. */
  apiKey?: string
}

/**
 * The provider name, and so the key its per-call options must be filed under.
 * Exported because `service.ts` has to name it too, and a mismatch would be
 * silent — the options would just never reach the model.
 */
export const LOCAL_PROVIDER_NAME = 'orchestrator-local'

export function readConfig(env: Record<string, string | undefined>): OrchestratorConfig {
  const modelId = env.ORCHESTRATOR_MODEL
  if (!modelId) throw new Error('ORCHESTRATOR_MODEL must be set')

  const endpoint = env.ORCHESTRATOR_ENDPOINT
  if (!endpoint) throw new Error('ORCHESTRATOR_ENDPOINT must be set')

  const apiKey = env.ORCHESTRATOR_API_KEY
  return {
    modelId,
    endpoint,
    effort: env.ORCHESTRATOR_EFFORT ?? 'low',
    ...(apiKey ? { apiKey } : {}),
  }
}

export function resolveModel(env: Record<string, string | undefined>): LanguageModel {
  const config = readConfig(env)
  return createOpenAICompatible({
    name: LOCAL_PROVIDER_NAME,
    baseURL: `${config.endpoint}/v1`,
    // Keyless local servers (LM Studio) must keep working; a hosted endpoint
    // refuses without one. Passed only when set.
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  })(config.modelId)
}