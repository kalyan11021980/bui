import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { isComplete, outstandingFields } from '@/domain/application/queries'
import { applyCarry, carryNotice, type CarryNotice } from '@/domain/application/carry'
import { fieldInputId } from '@/ui/panel/FieldControl'
import type { Action, ApplicationState } from '@/domain/application/state'
import type { RequirementKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const individual: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license',
}

const business: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'GA',
  wantsGsa: false, licenses: ['dealer'], addressDiffersFromId: false,
  idForm: 'drivers_license',
}

/** Scoped to the form element — the row wrapper carries an aria-label too. */
const control = (label: RegExp) =>
  screen.getByLabelText(label, { selector: 'input, select, textarea' })

/**
 * A harness that wires the panel to the real reducer, the way page.tsx does.
 * Every other "completion" test on this branch drove the reducer directly
 * with the string 'x' and never passed through the UI at all — so none of
 * them could tell that the panel had no input control in it.
 */
function Harness({
  profile = individual,
  onState,
}: {
  profile?: ApplicantProfile
  onState?: (s: ApplicationState) => void
}) {
  const [state, setState] = useState(() => createApplication('app-1', profile))
  const [carry, setCarry] = useState<CarryNotice | null>(null)

  const at = '2026-08-01T12:00:00.000Z'

  /** Applies one action, carries what follows, and reports both, as page.tsx does. */
  const dispatch = (id: RequirementKey, action: Action) => {
    const result = applyCarry(applicationReducer(state, action), at)
    setState(result.state)
    setCarry(carryNotice(id, result.applied))
    onState?.(result.state)
  }

  const change = (id: RequirementKey, value: unknown) =>
    dispatch(id, { type: 'SET_VALUE', fieldId: id, value, source: 'user', at })

  const clear = (id: RequirementKey) =>
    dispatch(id, { type: 'CLEAR_VALUE', fieldId: id, at })

  return (
    <ApplicationPanel
      state={state}
      onChange={change}
      onClear={clear}
      onSubmit={() => undefined}
      {...(carry && { carry })}
    />
  )
}

describe('completing an application through the panel', () => {
  it('gets a typed value into application state', async () => {
    let latest: ApplicationState | undefined
    render(<Harness onState={(s) => { latest = s }} />)

    await userEvent.type(control(/first name/i), 'Ada')

    expect(latest?.fields.first_name?.value).toBe('Ada')
    // A value the user typed is confirmed by the act of typing it,
    // which is what makes the field stop being outstanding.
    expect(latest?.fields.first_name?.status).toBe('confirmed')
    expect(outstandingFields(latest!)).not.toContain('first_name')
  })

  it('completes a whole individual registration by typing, with no LLM and no OCR', async () => {
    let latest: ApplicationState | undefined
    render(<Harness onState={(s) => { latest = s }} />)

    // Real values, each one satisfying its own catalog schema — not the
    // string 'x' shoved past a reducer that never validated anything.
    const answers: Array<[RegExp, string]> = [
      [/primary activity/i, 'dealer'],
      [/preferred language/i, 'English'],
      [/first name/i, 'Ada'],
      [/last name/i, 'Lovelace'],
      [/driver's license number/i, 'D1234567'],
      [/id expiration date/i, '2030-04-30'],
      [/country that issued/i, 'US'],
      [/state that issued/i, 'GA'],
      [/date of birth/i, '1982-08-31'],
      [/^address$/i, '2345 Anywhere St'],
      [/^city$/i, 'Atlanta'],
      [/^state$/i, 'GA'],
      [/zip code/i, '30301'],
      [/mobile phone/i, '4045551234'],
    ]
    for (const [label, value] of answers) {
      await userEvent.type(control(label), value)
    }
    await userEvent.upload(
      control(/photos of your id/i),
      new File(['x'], 'licence-front.png', { type: 'image/png' }),
    )

    expect(latest).toBeDefined()
    expect(outstandingFields(latest!)).toEqual([])
    expect(isComplete(latest!)).toBe(true)
  })

  it('never disables the submit button, however much is outstanding', async () => {
    render(<Harness />)
    const submit = screen.getByRole('button', { name: /submit/i })
    expect(submit).not.toBeDisabled()
    expect(screen.getByText(/left to go/i)).toBeInTheDocument()

    await userEvent.type(control(/first name/i), 'Ada')
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled()
  })

  it('counts a typed field towards progress', async () => {
    render(<Harness />)
    // Anchored on "done": the panel also prints per-section counts since F1,
    // so a bare /^0 of / no longer names the overall summary uniquely.
    expect(screen.getByText(/^0 of \d+ done$/)).toBeInTheDocument()
    await userEvent.type(control(/first name/i), 'Ada')
    expect(screen.getByText(/^1 of \d+ done$/)).toBeInTheDocument()
  })

  it('says what it just filled in for you, next to the field you typed into', async () => {
    // The bug this closes: carry WORKED and nobody could tell. The business
    // address is in a different section, below the fold, so the only place
    // the saving can be reported is where the applicant's eyes already are.
    render(<Harness profile={business} />)

    await userEvent.type(control(/^address$/i), '2345 Anywhere St')

    const ack = screen.getByText(/also filled in/i)
    expect(ack).toHaveTextContent(/business address/i)
    // Anchored to the SOURCE row, not floated as a toast that has vanished by
    // the time they look up.
    expect(
      screen.getByRole('group', { name: /^address$/i }).contains(ack),
    ).toBe(true)
  })

  it('takes you to what it filled in when you ask', async () => {
    render(<Harness profile={business} />)
    await userEvent.type(control(/^address$/i), '2345 Anywhere St')

    await userEvent.click(screen.getByRole('button', { name: /go to business address/i }))

    expect(document.activeElement).toBe(
      document.getElementById(fieldInputId('biz_addr_line1')),
    )
  })

  it('says nothing when an edit saved you nothing', async () => {
    // An acknowledgement that appears on every keystroke regardless is noise,
    // and noise is what people learn to stop reading.
    render(<Harness profile={business} />)
    await userEvent.type(control(/first name/i), 'Ada')
    expect(screen.queryByText(/also filled in/i)).toBeNull()
  })

  it('lowers the done count again when a field is cleared', async () => {
    // F3: the record used to go on holding "Ada" with status confirmed after
    // the applicant emptied the box, and the footer went on reading 1 of 12.
    // They would then submit a value that was not on their screen.
    let latest: ApplicationState | undefined
    render(<Harness onState={(s) => { latest = s }} />)

    await userEvent.type(control(/first name/i), 'Ada')
    expect(screen.getByText(/^1 of \d+ done$/)).toBeInTheDocument()

    await userEvent.clear(control(/first name/i))

    expect(screen.getByText(/^0 of \d+ done$/)).toBeInTheDocument()
    expect(latest?.fields.first_name?.value).toBeNull()
    expect(outstandingFields(latest!)).toContain('first_name')
  })

  it('drops a stale valid value when a correction passes through invalid', async () => {
    let latest: ApplicationState | undefined
    render(<Harness onState={(s) => { latest = s }} />)

    await userEvent.type(control(/zip code/i), '30301')
    expect(latest?.fields.addr_zip?.value).toBe('30301')

    await userEvent.type(control(/zip code/i), '9')

    expect(control(/zip code/i)).toHaveValue('303019')
    expect(latest?.fields.addr_zip?.value).toBeNull()
    expect(screen.getByText(/^0 of \d+ done$/)).toBeInTheDocument()
    // The value is dropped, not the message: suppressing the error would be
    // solving the wrong half of this.
    expect(await screen.findByRole('alert')).toHaveTextContent(/ZIP/i)
  })

  it('clears the business address it carried when the source is cleared', async () => {
    // A plausible carried value with nothing behind it is exactly what gets
    // rubber-stamped, and it is a value the applicant deleted.
    let latest: ApplicationState | undefined
    render(<Harness profile={business} onState={(s) => { latest = s }} />)

    await userEvent.type(control(/^address$/i), '2345 Anywhere St')
    expect(latest?.fields.biz_addr_line1?.value).toBe('2345 Anywhere St')

    await userEvent.clear(control(/^address$/i))

    expect(latest?.fields.biz_addr_line1?.value).toBeNull()
    expect(screen.getByText(/also cleared/i)).toHaveTextContent(/business address/i)
  })

  it('keeps a rejected value out of state and out of the count', async () => {
    let latest: ApplicationState | undefined
    render(<Harness onState={(s) => { latest = s }} />)

    await userEvent.type(control(/zip code/i), 'not-a-zip')

    expect(latest?.fields.addr_zip).toBeUndefined()
    expect(screen.getByText(/^0 of \d+ done$/)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/ZIP/i)
  })
})

describe('the panel asks for the number the declared ID actually carries', () => {
  const queryControl = (label: RegExp) =>
    screen.queryByLabelText(label, { selector: 'input, select, textarea' })

  const LICENCE = /driver's license number/i
  const ID_CARD = /id card number/i
  const PASSPORT = /passport number/i
  const ISSUING_STATE = /state that issued/i

  it('asks a licence holder for a licence number', () => {
    render(<Harness profile={{ ...individual, idForm: 'drivers_license' }} />)
    expect(control(LICENCE)).toBeInTheDocument()
    expect(queryControl(ID_CARD)).not.toBeInTheDocument()
    expect(queryControl(PASSPORT)).not.toBeInTheDocument()
  })

  it('asks a state ID holder for an ID card number instead', () => {
    render(<Harness profile={{ ...individual, idForm: 'state_id' }} />)
    expect(control(ID_CARD)).toBeInTheDocument()
    expect(queryControl(LICENCE)).not.toBeInTheDocument()
  })

  it('asks a passport holder for a passport number, and no issuing state', () => {
    render(<Harness profile={{ ...individual, idForm: 'passport' }} />)
    expect(control(PASSPORT)).toBeInTheDocument()
    expect(queryControl(LICENCE)).not.toBeInTheDocument()
    expect(queryControl(ISSUING_STATE)).not.toBeInTheDocument()
    // Guards the negatives: the rest of identification is still on screen.
    expect(control(/country that issued/i)).toBeInTheDocument()
  })

  it('asks a licence and ID card holder which state issued it', () => {
    for (const idForm of ['drivers_license', 'state_id'] as const) {
      const { unmount } = render(<Harness profile={{ ...individual, idForm }} />)
      expect(control(ISSUING_STATE), idForm).toBeInTheDocument()
      unmount()
    }
  })
})
