import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockView } from '@/ui/chat/blocks'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import type { ApplicationState, FieldState } from '@/domain/application/state'
import type { ApplicantProfile } from '@/domain/requirements/rules'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { FieldRow } from '@/ui/panel/FieldRow'
import { DocumentUpload } from '@/ui/panel/DocumentUpload'

const CONTROL = { selector: 'input, select, textarea' } as const

const PROFILE: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA', wantsGsa: false,
  licenses: [], addressDiffersFromId: false, idForm: 'drivers_license',
}
const state = createApplication('app-1', PROFILE, 'owner-token-1')

const handlers = { onChange: vi.fn(), onClear: vi.fn(), onConfirm: vi.fn(), onReadDocument: vi.fn() }

describe('BlockView — field_ask', () => {
  it("renders the field's real input control, labelled", () => {
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />)
    const input = screen.getByLabelText(/first name/i, CONTROL)
    expect(input).toHaveAttribute('type', 'text')
  })

  it('renders the vetted rationale beside the control', () => {
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />)
    // Verbatim catalog copy, not a paraphrase.
    expect(screen.getByText('Your account has to match the name on your ID')).toBeInTheDocument()
    expect(screen.getByText(/required by federal identity rules/i)).toBeInTheDocument()
  })

  it('sends a keystroke to onChange, not to any network call this component makes itself', async () => {
    const onChange = vi.fn()
    render(
      <BlockView
        seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state}
        onChange={onChange} onClear={vi.fn()} onConfirm={vi.fn()} onReadDocument={vi.fn()}
      />,
    )
    await userEvent.type(screen.getByLabelText(/first name/i, CONTROL), 'Ada')
    expect(onChange).toHaveBeenCalledWith('first_name', 'Ada')
  })

  it("uses a distinct id from the panel's own row for the same field, so neither <label> mislabels the other", () => {
    // The guard only ever permits a field_ask for an outstanding field, so
    // the panel already renders a row for it — this collision is guaranteed
    // by construction, not a corner case.
    render(
      <>
        <FieldRow fieldId="first_name" state={undefined} onChange={vi.fn()} onClear={vi.fn()} />
        <BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />
      </>,
    )
    const inputs = screen.getAllByLabelText(/first name/i, CONTROL)
    expect(inputs).toHaveLength(2)
    const ids = inputs.map((el) => el.id)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('uses a distinct id across two turns asking the same field, so the second re-ask does not collide with the first', () => {
    // useConversation never prunes history, and the fallback in
    // orchestrator/service.ts can re-ask the same outstanding field on
    // consecutive turns — both renders end up in the DOM at once.
    render(
      <>
        <BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />
        <BlockView seq={2} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />
      </>,
    )
    const inputs = screen.getAllByLabelText(/first name/i, CONTROL)
    expect(inputs).toHaveLength(2)
    const ids = inputs.map((el) => el.id)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('wires the group to the rationale it names, not a dangling id', () => {
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={state} {...handlers} />)
    const group = screen.getByRole('group', { name: /first name/i })
    const describedBy = group.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toContainElement(
      screen.getByText('Your account has to match the name on your ID'),
    )
  })
})

describe('BlockView — field_ask, answered feedback', () => {
  function withField(fieldId: string, field: FieldState): ApplicationState {
    return { ...state, fields: { ...state.fields, [fieldId]: field } }
  }

  it('a derived field offers "Looks right" and no answered line yet', () => {
    const derived = withField('first_name', {
      value: 'Ada', status: 'derived', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={derived} {...handlers} />)
    expect(screen.getByRole('button', { name: /looks right/i })).toBeInTheDocument()
    expect(screen.queryByText(vettedCopy('field_confirmed'))).toBeNull()
  })

  it('a confirmed field says it is answered where the button used to be', () => {
    const confirmed = withField('first_name', {
      value: 'Ada', status: 'confirmed', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={confirmed} {...handlers} />)
    expect(screen.queryByRole('button', { name: /looks right/i })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(vettedCopy('field_confirmed'))
  })

  it('a verified field reads as answered too', () => {
    const verified = withField('first_name', {
      value: 'Ada', status: 'verified', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={verified} {...handlers} />)
    expect(screen.getByRole('status')).toHaveTextContent(vettedCopy('field_confirmed'))
  })
})

describe('BlockView — field_ask, OCR-derived address (automation-bias guard)', () => {
  function withField(fieldId: string, field: FieldState): ApplicationState {
    return { ...state, fields: { ...state.fields, [fieldId]: field } }
  }

  it('asks whether an OCR-derived address is still current, rather than presenting it as settled', () => {
    const ocrState = withField('addr_line1', {
      value: '123 Main St', status: 'derived', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'addr_line1' }} state={ocrState} {...handlers} />)
    expect(screen.getByText(vettedCopy('address_still_current'))).toBeInTheDocument()
  })

  it('does not ask the question for an address field with nothing entered yet', () => {
    // The field carries no value and no provenance — the case the guard must
    // NOT fire for, or the question would be meaningless noise on every blank
    // address field, not just an OCR-derived one.
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'addr_line1' }} state={state} {...handlers} />)
    expect(screen.queryByText(vettedCopy('address_still_current'))).toBeNull()
  })

  it('does not ask the question for an address field the applicant typed themselves', () => {
    const typedState = withField('addr_line1', {
      value: '123 Main St', status: 'confirmed', provenance: { source: 'user' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'addr_line1' }} state={typedState} {...handlers} />)
    expect(screen.queryByText(vettedCopy('address_still_current'))).toBeNull()
  })

  it('does not ask the question for a non-address field, even one read by OCR', () => {
    // Proves the gate is on "address field", not merely "any OCR-sourced
    // value" — first_name is OCR-derived here but is not an address.
    const ocrName = withField('first_name', {
      value: 'Ada', status: 'derived', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'first_name' }} state={ocrName} {...handlers} />)
    expect(screen.queryByText(vettedCopy('address_still_current'))).toBeNull()
  })

  it('affirming goes through CONFIRM, not a value re-submit, so OCR provenance survives', async () => {
    // The regression this guards: SET_VALUE (what onChange dispatches)
    // unconditionally overwrites provenance, so re-submitting the same
    // value under source 'user' would make a machine-read address
    // indistinguishable from one the applicant typed from scratch — exactly
    // the evidence this question exists to preserve. onChange/onClear stay
    // real vi.fn()s so a regression back to calling onChange would be
    // visible below; only onConfirm runs through the actual reducer.
    const ocrState = withField('addr_line1', {
      value: '123 Main St', status: 'derived', provenance: { source: 'ocr' },
    })
    const onChange = vi.fn()
    let afterConfirm: ApplicationState | undefined
    const onConfirm = (id: string) => {
      afterConfirm = applicationReducer(ocrState, {
        type: 'CONFIRM', fieldId: id, at: '2026-08-04T00:00:00.000Z', shownCopyHash: 'catalog-v1',
      })
    }
    render(
      <BlockView
        seq={1} block={{ kind: 'field_ask', fieldId: 'addr_line1' }} state={ocrState}
        onChange={onChange} onClear={vi.fn()} onConfirm={onConfirm} onReadDocument={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Yes, still current' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(afterConfirm!.fields.addr_line1?.status).toBe('confirmed')
    expect(afterConfirm!.fields.addr_line1?.provenance?.source).toBe('ocr')
  })

  it('offers the affirm and change options with equal visual weight', () => {
    const ocrState = withField('addr_line1', {
      value: '123 Main St', status: 'derived', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'addr_line1' }} state={ocrState} {...handlers} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    const [first, second] = buttons
    // Same style object, not one primary + one secondary like FieldRow's
    // "Looks right"/"Fix this" — that asymmetry is exactly what nudges bulk
    // acceptance, which this question exists to avoid.
    expect(getComputedStyle(first!).backgroundColor).toBe(getComputedStyle(second!).backgroundColor)
    expect(getComputedStyle(first!).color).toBe(getComputedStyle(second!).color)
  })
})

describe('BlockView — field_ask, OCR-derived non-address field', () => {
  function withField(fieldId: string, field: FieldState): ApplicationState {
    return { ...state, fields: { ...state.fields, [fieldId]: field } }
  }
  const derivedDl: FieldState = {
    value: 'A9999999', status: 'derived', provenance: { source: 'ocr' },
  }

  it('offers "Looks right", wired to CONFIRM — the only way a chat-only applicant can settle an OCR value', async () => {
    // The screenshot bug: without this, a derived dl_number stays outstanding
    // forever and the agent re-asks it on every nudge.
    const onConfirm = vi.fn()
    render(
      <BlockView
        seq={1} block={{ kind: 'field_ask', fieldId: 'dl_number' }}
        state={withField('dl_number', derivedDl)}
        onChange={vi.fn()} onClear={vi.fn()} onConfirm={onConfirm} onReadDocument={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Looks right' }))
    expect(onConfirm).toHaveBeenCalledWith('dl_number')
  })

  it('offers no confirm button for a field with nothing entered yet', () => {
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'dl_number' }} state={state} {...handlers} />)
    expect(screen.queryByRole('button', { name: 'Looks right' })).toBeNull()
  })

  it('offers no confirm button once the value is confirmed', () => {
    const confirmed = withField('dl_number', {
      value: 'A9999999', status: 'confirmed', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'dl_number' }} state={confirmed} {...handlers} />)
    expect(screen.queryByRole('button', { name: 'Looks right' })).toBeNull()
  })

  it('keeps the still-current question, not "Looks right", for a derived address field', () => {
    const ocrAddr = withField('addr_line1', {
      value: '123 Main St', status: 'derived', provenance: { source: 'ocr' },
    })
    render(<BlockView seq={1} block={{ kind: 'field_ask', fieldId: 'addr_line1' }} state={ocrAddr} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Yes, still current' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Looks right' })).toBeNull()
  })
})

describe('BlockView — rationale', () => {
  it("renders the field's purpose and authority verbatim, without an input control", () => {
    render(<BlockView seq={1} block={{ kind: 'rationale', fieldId: 'dl_number' }} state={state} {...handlers} />)
    expect(screen.getByText('Confirms the ID you uploaded belongs to you')).toBeInTheDocument()
    expect(screen.getByText(/required by your state dmv/i)).toBeInTheDocument()
    // Distinguishes this from field_ask: a "why" block never offers to type
    // an answer — if the switch collapsed the two cases this would catch it.
    expect(screen.queryByLabelText(/driver's license number/i, CONTROL)).toBeNull()
  })
})

describe('BlockView — notice', () => {
  it('renders its vetted string', () => {
    render(<BlockView seq={1} block={{ kind: 'notice', copyId: 'guard_fallback' }} state={state} {...handlers} />)
    expect(screen.getByText(vettedCopy('guard_fallback'))).toBeInTheDocument()
  })
})

describe('BlockView — document_request', () => {
  it('renders the upload control for that document', () => {
    render(<BlockView seq={1} block={{ kind: 'document_request', docType: 'drivers_license' }} state={state} {...handlers} />)
    expect(screen.getByLabelText(/photo of your driver's license/i)).toBeInTheDocument()
  })

  it("uses a distinct id from the page-level upload for the same document type", () => {
    render(
      <>
        <DocumentUpload docType="drivers_license" onRead={vi.fn()} />
        <BlockView seq={1} block={{ kind: 'document_request', docType: 'drivers_license' }} state={state} {...handlers} />
      </>,
    )
    const inputs = screen.getAllByLabelText(/photo of your driver's license/i)
    expect(inputs).toHaveLength(2)
    const ids = inputs.map((el) => el.id)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })

  it('uses a distinct id across two turns requesting the same document, so a repeat request does not collide with the first', () => {
    render(
      <>
        <BlockView seq={1} block={{ kind: 'document_request', docType: 'drivers_license' }} state={state} {...handlers} />
        <BlockView seq={2} block={{ kind: 'document_request', docType: 'drivers_license' }} state={state} {...handlers} />
      </>,
    )
    const inputs = screen.getAllByLabelText(/photo of your driver's license/i)
    expect(inputs).toHaveLength(2)
    const ids = inputs.map((el) => el.id)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('BlockView — orientation', () => {
  it('renders the done/total counts', () => {
    render(<BlockView seq={1} block={{ kind: 'orientation', done: 3, total: 10 }} state={state} {...handlers} />)
    expect(screen.getByText(/3 of 10 done/i)).toBeInTheDocument()
  })
})
