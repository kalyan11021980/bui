import { describe, it, expect } from 'vitest'
import { systemPrompt, messagesFor } from '@/server/orchestrator/prompt'
import type { Turn } from '@/domain/orchestrator/transcript'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const view: OrchestratorView = {
  applicationId: 'app-1',
  profile: {
    applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
    licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
  },
  outstanding: [{ id: 'tax_id', label: 'Taxpayer ID', status: 'empty', sensitive: true }],
  settled: [],
  documentsOutstanding: [],
  submitted: false,
  rulesVersion: 1,
  panelOnly: false,
}

describe('systemPrompt', () => {
  it('is stable across calls so it can be a cacheable prefix', () => {
    expect(systemPrompt()).toBe(systemPrompt())
  })

  it('tells the model it never authors compliance copy', () => {
    expect(systemPrompt()).toMatch(/never/i)
  })
})

describe('messagesFor', () => {
  const agentTurn: Turn = {
    seq: 1, at: '2026-08-03T00:00:00.000Z', role: 'agent',
    voice: 'Right, a couple more.',
    blocks: [{ kind: 'field_ask', fieldId: 'tax_id' }],
  }

  it('renders an agent turn as its voice plus block identifiers', () => {
    const [first] = messagesFor(view, [agentTurn], null)
    const text = JSON.stringify(first)
    expect(text).toContain('Right, a couple more.')
    expect(text).toContain('tax_id')
  })

  it('never renders the resolved vetted copy of a block', () => {
    const withNotice: Turn = {
      ...agentTurn, blocks: [{ kind: 'notice', copyId: 'opening_beat' }],
    }
    const text = JSON.stringify(messagesFor(view, [withNotice], null))
    expect(text).not.toContain('four minutes')
    // Renders the identifier too, so an empty/dropped-block bug can't pass by
    // vacuously having nothing to contain either string.
    expect(text).toContain('opening_beat')
  })

  it('carries the applicant’s typed text', () => {
    const text = JSON.stringify(messagesFor(view, [], 'I am a dealer in Georgia'))
    expect(text).toContain('I am a dealer in Georgia')
  })

  it('puts the view in the prompt without any field value', () => {
    const text = JSON.stringify(messagesFor(view, [], null))
    expect(text).toContain('tax_id')
    expect(text).toContain('Taxpayer ID')
  })
})
