import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SectionDoneBar } from '@/ui/chat/SectionDoneBar'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import { PANEL_ONLY_THRESHOLD } from '@/domain/orchestrator/view'
import type { RequirementKey } from '@/domain/requirements/key'
import type { Section } from '@/domain/section'
import type { Turn } from '@/domain/orchestrator/transcript'

const AT = '2026-08-06T00:00:00.000Z'
const PROFILE = {
  applicantType: 'individual' as const, country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license' as const,
  bizCountry: null,
}

function fresh(): ApplicationState { return createApplication('app-1', PROFILE, 'tok') }

/** Answers every outstanding field except `keep`, looping until stable. */
function answeredExcept(keep: readonly RequirementKey[]): ApplicationState {
  let state = fresh()
  for (;;) {
    const next = outstandingFields(state).find((id) => !keep.includes(id))
    if (!next) return state
    state = applicationReducer(state, {
      type: 'SET_VALUE', fieldId: next, value: 'x', source: 'user', at: AT,
    })
  }
}

const presented = (section: Section): Turn => ({
  seq: 1, at: AT, role: 'agent', voice: null,
  blocks: [{ kind: 'section_header', section, done: 0, total: 1 }],
})

const noop = () => {}

/** Applies count RECORD_REJECTION actions in a row. */
function rejectedTimes(base: ApplicationState, count: number): ApplicationState {
  let s = base
  for (let i = 0; i < count; i += 1) {
    s = applicationReducer(s, { type: 'RECORD_REJECTION', at: AT })
  }
  return s
}

const state = answeredExcept(['addr_city'])
const complete = answeredExcept([])
const submitted = applicationReducer(complete, { type: 'SUBMIT', at: AT })

describe('SectionDoneBar', () => {
  it('renders one Done button for the presented section', () => {
    render(<SectionDoneBar state={state} turns={[presented('address')]} sendable onDone={noop} />)
    expect(screen.getByRole('button', { name: 'Done with this section' })).toBeInTheDocument()
  })

  it('reports the presented section on press', async () => {
    const onDone = vi.fn()
    render(<SectionDoneBar state={state} turns={[presented('address')]} sendable onDone={onDone} />)
    await userEvent.click(screen.getByRole('button', { name: 'Done with this section' }))
    expect(onDone).toHaveBeenCalledWith('address')
  })

  it('refuses, never disables, while unsendable', async () => {
    const onDone = vi.fn()
    render(<SectionDoneBar state={state} turns={[presented('address')]} sendable={false} onDone={onDone} />)
    const button = screen.getByRole('button', { name: 'Done with this section' })
    expect(button).not.toBeDisabled()
    await userEvent.click(button)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('renders nothing before any group is presented', () => {
    const { container } = render(<SectionDoneBar state={state} turns={[]} sendable onDone={noop} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing once everything is answered — the CompletionCard takes over', () => {
    const { container } = render(
      <SectionDoneBar state={complete} turns={[presented('contact')]} sendable onDone={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing after submission', () => {
    const { container } = render(
      <SectionDoneBar state={submitted} turns={[presented('address')]} sendable onDone={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing once the guard has dropped the agent to panel-only', () => {
    const panelOnly = rejectedTimes(state, PANEL_ONLY_THRESHOLD)
    const { container } = render(
      <SectionDoneBar state={panelOnly} turns={[presented('address')]} sendable onDone={noop} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders from the committed transcript when this session has no turns yet — resume', () => {
    const resumed = applicationReducer(state, { type: 'APPEND_TURN', turn: presented('address'), at: AT })
    render(<SectionDoneBar state={resumed} turns={[]} sendable onDone={noop} />)
    expect(screen.getByRole('button', { name: 'Done with this section' })).toBeInTheDocument()
  })
})
