import { describe, it, expect } from 'vitest'
import { readConfig } from '@/server/orchestrator/model'

const base = { ORCHESTRATOR_MODEL: 'some-model', ORCHESTRATOR_ENDPOINT: 'http://host:1234' }

describe('readConfig', () => {
  it('defaults to the local provider', () => {
    expect(readConfig({ ...base }).provider).toBe('local')
  })

  it('requires an endpoint for the local provider', () => {
    expect(() => readConfig({ ORCHESTRATOR_MODEL: 'm' }))
      .toThrow(/ORCHESTRATOR_ENDPOINT/)
  })

  it('requires a model id whatever the provider', () => {
    expect(() => readConfig({ ORCHESTRATOR_ENDPOINT: 'http://h:1' }))
      .toThrow(/ORCHESTRATOR_MODEL/)
  })

  it('requires an api key for the anthropic provider', () => {
    expect(() => readConfig({ ...base, ORCHESTRATOR_PROVIDER: 'anthropic' }))
      .toThrow(/ANTHROPIC_API_KEY/)
  })

  it('rejects an unrecognised provider rather than falling back to local', () => {
    expect(() => readConfig({ ...base, ORCHESTRATOR_PROVIDER: 'openai' }))
      .toThrow(/openai/)
  })

  it('carries effort through, defaulting to low', () => {
    expect(readConfig({ ...base }).effort).toBe('low')
    expect(readConfig({ ...base, ORCHESTRATOR_EFFORT: 'high' }).effort).toBe('high')
  })
})
