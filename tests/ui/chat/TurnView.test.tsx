import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TurnView } from '@/ui/chat/TurnView'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import type { Turn } from '@/domain/orchestrator/transcript'

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}
const state = createApplication('app-1', PROFILE, 'owner-token-1')
const AT = '2026-08-04T00:00:00.000Z'
const handlers = { onChange: vi.fn(), onClear: vi.fn(), onConfirm: vi.fn(), onReadDocument: vi.fn() }

describe('TurnView — agent turns', () => {
  it('renders the voice when present', () => {
    const turn: Turn = { seq: 1, at: AT, role: 'agent', voice: 'Hi there', blocks: [] }
    const { container } = render(<TurnView turn={turn} state={state} {...handlers} />)
    expect(screen.getByText('Hi there')).toBeInTheDocument()
    // Exactly one rendered line: the voice, and nothing standing in for a block.
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('renders nothing in place of the voice when it is null — no placeholder, no empty bubble', () => {
    const turn: Turn = {
      seq: 1, at: AT, role: 'agent', voice: null, voiceDropped: 'lint',
      blocks: [{ kind: 'notice', copyId: 'guard_fallback' }],
    }
    const { container } = render(<TurnView turn={turn} state={state} {...handlers} />)
    // Only the notice's own <p> exists — a voice placeholder would make this 2.
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })
})

describe('TurnView — applicant turns', () => {
  it('renders only what the applicant typed, never a block', () => {
    const turn: Turn = {
      seq: 1, at: AT, role: 'applicant', voice: null, blocks: [], text: 'I am a dealer in Georgia',
    }
    const { container } = render(<TurnView turn={turn} state={state} {...handlers} />)
    expect(screen.getByText('I am a dealer in Georgia')).toBeInTheDocument()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })
})
