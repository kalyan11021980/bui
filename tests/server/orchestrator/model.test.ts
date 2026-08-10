import { describe, it, expect } from 'vitest'
import { readConfig } from '@/server/orchestrator/model'

const base = { ORCHESTRATOR_MODEL: 'some-model', ORCHESTRATOR_ENDPOINT: 'http://host:1234' }

describe('readConfig', () => {
  it('requires an endpoint', () => {
    expect(() => readConfig({ ORCHESTRATOR_MODEL: 'm' }))
      .toThrow(/ORCHESTRATOR_ENDPOINT/)
  })

  it('requires a model id', () => {
    expect(() => readConfig({ ORCHESTRATOR_ENDPOINT: 'http://h:1' }))
      .toThrow(/ORCHESTRATOR_MODEL/)
  })

  it('carries effort through, defaulting to low', () => {
    expect(readConfig({ ...base }).effort).toBe('low')
    expect(readConfig({ ...base, ORCHESTRATOR_EFFORT: 'high' }).effort).toBe('high')
  })

  it('carries an api key when one is set', () => {
    const config = readConfig({ ...base, ORCHESTRATOR_API_KEY: 'sk-test' })
    expect(config.apiKey).toBe('sk-test')
  })

  it('is keyless when no api key is set', () => {
    // LM Studio answers without a key; it must keep working that way.
    expect(readConfig({ ...base }).apiKey).toBeUndefined()
  })
})