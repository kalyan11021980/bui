import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export type OrchestratorConfig = {
  provider: 'local' | 'anthropic'
  modelId: string
  endpoint?: string
  /** Ignored by the local provider: an OpenAI-compatible endpoint has no equivalent. */
  effort: string
  apiKey?: string
}

const PROVIDERS = new Set(['local', 'anthropic'])

export function readConfig(env: NodeJS.ProcessEnv): OrchestratorConfig {
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
    return { provider, modelId, effort, apiKey }
  }

  const endpoint = env.ORCHESTRATOR_ENDPOINT
  if (!endpoint) throw new Error('ORCHESTRATOR_ENDPOINT must be set when ORCHESTRATOR_PROVIDER=local')
  return { provider, modelId, effort, endpoint }
}

export function resolveModel(env: NodeJS.ProcessEnv): LanguageModel {
  const config = readConfig(env)
  if (config.provider === 'anthropic') {
    return createAnthropic({ apiKey: config.apiKey })(config.modelId)
  }
  return createOpenAICompatible({
    name: 'orchestrator-local',
    baseURL: `${config.endpoint}/v1`,
  })(config.modelId)
}
