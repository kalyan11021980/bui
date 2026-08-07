import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export type OrchestratorConfig =
  | {
      provider: 'local'
      modelId: string
      endpoint: string
      effort: string
      /** Absent for a keyless local server (LM Studio); required by hosted ones. */
      apiKey?: string
    }
  | {
      provider: 'anthropic'
      modelId: string
      effort: string
      apiKey: string
    }

const PROVIDERS = new Set(['local', 'anthropic'])

/**
 * The provider name, and so the key its per-call options must be filed under.
 * Exported because `service.ts` has to name it too, and a mismatch would be
 * silent — the options would just never reach the model.
 */
export const LOCAL_PROVIDER_NAME = 'orchestrator-local'

export function readConfig(env: Record<string, string | undefined>): OrchestratorConfig {
  const provider = env.ORCHESTRATOR_PROVIDER ?? 'local'
  if (!PROVIDERS.has(provider)) {
    throw new Error(
      `ORCHESTRATOR_PROVIDER must be "local" or "anthropic", got "${provider}"`,
    )
  }

  const modelId = env.ORCHESTRATOR_MODEL
  if (!modelId) throw new Error('ORCHESTRATOR_MODEL must be set')

  const effort = env.ORCHESTRATOR_EFFORT ?? 'low'

  if (provider === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set when ORCHESTRATOR_PROVIDER=anthropic')
    return { provider: 'anthropic', modelId, effort, apiKey }
  }

  const endpoint = env.ORCHESTRATOR_ENDPOINT
  if (!endpoint) throw new Error('ORCHESTRATOR_ENDPOINT must be set when ORCHESTRATOR_PROVIDER=local')
  const apiKey = env.ORCHESTRATOR_API_KEY
  return { provider: 'local', modelId, effort, endpoint, ...(apiKey ? { apiKey } : {}) }
}

export function resolveModel(env: Record<string, string | undefined>): LanguageModel {
  const config = readConfig(env)
  if (config.provider === 'anthropic') {
    return createAnthropic({ apiKey: config.apiKey })(config.modelId)
  }
  return createOpenAICompatible({
    name: LOCAL_PROVIDER_NAME,
    baseURL: `${config.endpoint}/v1`,
    // Keyless local servers (LM Studio) must keep working; a hosted endpoint
    // refuses without one. Passed only when set.
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  })(config.modelId)
}
