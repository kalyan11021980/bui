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

  // The planner places the section's questions; the model narrates. A reply
  // with no tool call is the designed-for case now, not a wasted turn.
  it('tells the model a tool-free reply is normal, and never mentions askFor', () => {
    expect(systemPrompt()).toMatch(/reply with no tool call is normal/i)
    expect(systemPrompt()).not.toContain('askFor')
  })

  it('tells the model it cannot ask questions itself', () => {
    expect(systemPrompt()).toMatch(/cannot ask questions/i)
  })

  // A live model narrated markdown ("your **primary activity**") and the
  // chat renders voice as plain text — asterisks reached the applicant
  // literally. Pins the rule so a future rewrite can't silently drop it.
  it('tells the model to write plain sentences with no markdown', () => {
    expect(systemPrompt()).toMatch(/no markdown/i)
    expect(systemPrompt()).toMatch(/asterisks/i)
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

  it('describes a presented section to the model', () => {
    const turn: Turn = {
      seq: 1, at: '2026-08-03T00:00:00.000Z', role: 'agent', voice: null,
      blocks: [{ kind: 'section_header', section: 'address', done: 1, total: 4 }],
    }
    const messages = messagesFor(view, [turn], null)
    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant?.content).toContain('presented section: address (1 of 4 answered)')
  })
})
