import { describe, it, expect } from 'vitest'
import { systemPrompt, messagesFor } from '@/server/orchestrator/prompt'
import type { Turn } from '@/domain/orchestrator/transcript'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const view: OrchestratorView = {
  applicationId: 'app-1',
  profile: {
    applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
    licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
    bizCountry: null,
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

  // Markdown is now allowed and the chat renders it, but the content rules
  // that protect vetted copy still hold. Pins the rules so a future rewrite
  // can't silently drop either side: light markdown yes, numerals and
  // legal-obligation claims never, and the risky markdown shapes (links,
  // headings, code, numbered lists) still off limits.
  it('allows light markdown but keeps the no-numerals and no-legal-claim rules', () => {
    const p = systemPrompt()
    expect(p).toMatch(/markdown/i)
    expect(p).toMatch(/asterisks/i)
    expect(p).toMatch(/no numerals/i)
    expect(p).toMatch(/no statements about legal obligation/i)
    expect(p).toMatch(/no links/i)
    expect(p).toMatch(/no numbered lists/i)
  })

  it('lets the model answer a free-form question with more than a couple of sentences', () => {
    expect(systemPrompt()).toMatch(/free-form question/i)
    expect(systemPrompt()).toMatch(/a few sentences or a short list of at most four items/i)
  })

  it('tells the model not to claim a question is on screen for a free-form turn', () => {
    expect(systemPrompt()).toMatch(/never say a question is on screen/i)
  })

  it('tells the model to answer how-long / how-much qualitatively, never a quantity', () => {
    expect(systemPrompt()).toMatch(/qualitatively/i)
    expect(systemPrompt()).toMatch(/never give a specific quantity/i)
  })

  // Kaly calls the em dash "the AI dash" and does not want it in the chat.
  // Pins both the rule and that the prompt itself does not model the thing
  // it bans (an em dash in the prompt would leak into the model's style).
  it('bans em dashes and contains none itself', () => {
    expect(systemPrompt()).toMatch(/never use em dashes/i)
    expect(systemPrompt()).not.toContain('—')
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
