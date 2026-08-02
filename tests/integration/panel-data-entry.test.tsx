import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
import { applyCarry, carryNotice, type CarryNotice } from '@/domain/application/carry'
import { fieldInputId } from '@/ui/panel/FieldInput'
import type { ApplicationState } from '@/domain/application/state'
import type { RequirementKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const individual: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA',
  wantsGsa: false, licenses: [],
}

const business: ApplicantProfile = {
  applicantType: 'business', country: 'US', state: 'GA',
  wantsGsa: false, licenses: ['dealer'],
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

  const change = (id: RequirementKey, value: unknown) => {
    const at = '2026-08-01T12:00:00.000Z'
    const result = applyCarry(
      applicationReducer(state, {
        type: 'SET_VALUE', fieldId: id, value, source: 'user', at,
      }),
      at,
    )
    setState(result.state)
    setCarry(carryNotice(id, result.applied))
    onState?.(result.state)
  }

  return (
    <ApplicationPanel
      state={state}
      onChange={change}
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
    // A value the user typed is confirmed by the act of typing it (§9.1),
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
      [/first name/i, 'Ada'],
      [/last name/i, 'Lovelace'],
      [/driver's license number/i, 'D1234567'],
      [/id expiration date/i, '2030-04-30'],
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
    await userEvent.selectOptions(
      control(/form of identification/i), 'drivers_license',
    )
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

  it('keeps a rejected value out of state and out of the count', async () => {
    let latest: ApplicationState | undefined
    render(<Harness onState={(s) => { latest = s }} />)

    await userEvent.type(control(/zip code/i), 'not-a-zip')

    expect(latest?.fields.addr_zip).toBeUndefined()
    expect(screen.getByText(/^0 of \d+ done$/)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/ZIP/i)
  })
})
