import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockView } from '@/ui/chat/blocks'
import { createApplication } from '@/domain/application/reducer'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import { vettedCopy } from '@/domain/orchestrator/copy'

const CONTROL = { selector: 'input, select, textarea' } as const

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}
const state = createApplication('app-1', PROFILE, 'owner-token-1')

const handlers = { onChange: vi.fn(), onClear: vi.fn(), onReadDocument: vi.fn() }

describe('BlockView — field_ask', () => {
  it("renders the field's real input control, labelled", () => {
    render(<BlockView block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />)
    const input = screen.getByLabelText(/first name/i, CONTROL)
    expect(input).toHaveAttribute('type', 'text')
  })

  it('renders the vetted rationale beside the control', () => {
    render(<BlockView block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />)
    // Verbatim catalog copy, not a paraphrase.
    expect(screen.getByText('Your account has to match the name on your ID')).toBeInTheDocument()
    expect(screen.getByText(/required by federal identity rules/i)).toBeInTheDocument()
  })

  it('sends a keystroke to onChange, not to any network call this component makes itself', async () => {
    const onChange = vi.fn()
    render(
      <BlockView
        block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state}
        onChange={onChange} onClear={vi.fn()} onReadDocument={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByLabelText(/first name/i, CONTROL), 'Ada')
    expect(onChange).toHaveBeenCalledWith('first_name', 'Ada')
  })
})

describe('BlockView — rationale', () => {
  it("renders the field's purpose and authority verbatim, without an input control", () => {
    render(<BlockView block={{ kind: 'rationale', fieldId: 'dl_number' }} state={state} {...handlers} />)
    expect(screen.getByText('Confirms the ID you uploaded belongs to you')).toBeInTheDocument()
    expect(screen.getByText(/required by your state dmv/i)).toBeInTheDocument()
    // Distinguishes this from field_ask: a "why" block never offers to type
    // an answer — if the switch collapsed the two cases this would catch it.
    expect(screen.queryByLabelText(/driver's license number/i, CONTROL)).toBeNull()
  })
})

describe('BlockView — notice', () => {
  it('renders its vetted string', () => {
    render(<BlockView block={{ kind: 'notice', copyId: 'guard_fallback' }} state={state} {...handlers} />)
    expect(screen.getByText(vettedCopy('guard_fallback'))).toBeInTheDocument()
  })
})

describe('BlockView — document_request', () => {
  it('renders the upload control for that document', () => {
    render(<BlockView block={{ kind: 'document_request', docType: 'drivers_license' }} state={state} {...handlers} />)
    expect(screen.getByLabelText(/photo of your driver's license/i)).toBeInTheDocument()
  })
})

describe('BlockView — orientation', () => {
  it('renders the done/total counts', () => {
    render(<BlockView block={{ kind: 'orientation', done: 3, total: 10 }} state={state} {...handlers} />)
    expect(screen.getByText(/3 of 10 done/i)).toBeInTheDocument()
  })
})
