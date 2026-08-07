import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import { requiredFields } from '@/domain/requirements/engine'
import type { ApplicantProfile } from '@/domain/requirements/rules'

/** The domain does not check it; the server does. */
const OWNER = 'owner-token-1'

const AT = '2026-08-01T12:00:00.000Z'
const profile: ApplicantProfile = {
  applicantType: 'individual', country: 'US', state: 'GA',
  wantsGsa: false, licenses: [], addressDiffersFromId: false,
  idForm: 'drivers_license',
  bizCountry: null,
}

describe('ApplicationPanel', () => {
  it('shows how many fields are left', () => {
    const s = createApplication('app-1', profile, OWNER)
    render(<ApplicationPanel state={s} />)
    const total = outstandingFields(s).length
    expect(screen.getByText(new RegExp(`0 of ${total}`))).toBeInTheDocument()
  })

  it('renders a row for every required field, not just the outstanding ones', () => {
    // On a fresh application, outstanding === required, so asserting against
    // outstandingFields() couldn't distinguish "renders every required field"
    // from a bug that rendered only the outstanding ones. Completing one
    // field makes the two counts diverge — a satisfied field must still be
    // visible and revisitable, not disappear from the panel.
    let s = createApplication('app-1', profile, OWNER)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    expect(outstandingFields(s).length).toBeLessThan(requiredFields(s.profile).length)
    render(<ApplicationPanel state={s} />)
    expect(screen.getAllByRole('group')).toHaveLength(requiredFields(s.profile).length)
  })

  it('never disables the submit button — it explains instead', () => {
    const s = createApplication('app-1', profile, OWNER)
    render(<ApplicationPanel state={s} />)
    const btn = screen.getByRole('button', { name: /submit/i })
    expect(btn).not.toBeDisabled()
    expect(screen.getByText(/left to go/i)).toBeInTheDocument()
  })

  it('reports progress as fields are completed', () => {
    let s = createApplication('app-1', profile, OWNER)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'user', at: AT,
    })
    render(<ApplicationPanel state={s} />)
    // Anchored on "done": since F1 the panel also prints a per-section count
    // ("1 of 4"), so a bare /^1 of / no longer names the overall summary
    // uniquely. The assertion is stronger, not weaker — it now says WHICH
    // count it means.
    expect(screen.getByText(/^1 of \d+ done$/)).toBeInTheDocument()
  })

  it('passes a confirm through to the caller', async () => {
    const onConfirm = vi.fn()
    let s = createApplication('app-1', profile, OWNER)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT,
    })
    render(<ApplicationPanel state={s} onConfirm={onConfirm} />)
    await userEvent.click(
      screen.getAllByRole('button', { name: /looks right/i })[0]!,
    )
    expect(onConfirm).toHaveBeenCalledWith('first_name')
  })

  it('threads the document image down to the row that has a box', () => {
    let s = createApplication('app-1', profile, OWNER)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT, documentId: 'doc-1', box: [10, 20, 100, 60],
    })
    render(
      <ApplicationPanel
        state={s}
        documents={{ 'doc-1': { url: 'blob:doc', size: { width: 800, height: 500 } } }}
      />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('does not offer a crop when the panel was never given the document', () => {
    // The common case pre-upload, and every case after a reload: a box can
    // exist on the record while the browser holds no pixels for it.
    let s = createApplication('app-1', profile, OWNER)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'first_name', value: 'Kalyan',
      source: 'ocr', at: AT, box: [10, 20, 100, 60],
    })
    render(<ApplicationPanel state={s} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('calls onSubmit when everything is done', async () => {
    const onSubmit = vi.fn()
    let s = createApplication('app-1', profile, OWNER)
    for (const id of outstandingFields(s)) {
      s = applicationReducer(s, {
        type: 'SET_VALUE', fieldId: id, value: 'x', source: 'user', at: AT,
      })
    }
    render(<ApplicationPanel state={s} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('chunks the rows under headings instead of one 25-field column', () => {
    // The whole of F1: an undifferentiated column is what pushed the carried
    // business address ~600px below the fold, so the applicant reported a
    // working feature as broken. Headings are what make "it landed over
    // there" a sentence the screen can finish.
    const s = createApplication('app-1', profile, OWNER)
    render(<ApplicationPanel state={s} />)

    expect(screen.getByRole('heading', { name: /^identification$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^address$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^contact$/i })).toBeInTheDocument()

    // Each row sits under the heading its own catalog entry names.
    const address = screen.getByRole('region', { name: /^address$/i })
    expect(within(address).getByRole('group', { name: /^zip code$/i })).toBeInTheDocument()
    expect(within(address).queryByRole('group', { name: /^first name$/i })).toBeNull()
  })

  it('shows how far along each section is, not just the whole application', () => {
    let s = createApplication('app-1', profile, OWNER)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'addr_city', value: 'Atlanta',
      source: 'user', at: AT,
    })
    render(<ApplicationPanel state={s} />)

    // CORE_ADDRESS is four fields; one of them is now answered.
    const address = screen.getByRole('region', { name: /^address$/i })
    expect(within(address).getByText('1 of 4')).toBeInTheDocument()
    // Identification is untouched, so the two counts must differ — a bug that
    // rendered the OVERALL count in every heading would pass otherwise.
    const identification = screen.getByRole('region', { name: /^identification$/i })
    expect(within(identification).getByText('0 of 8')).toBeInTheDocument()
  })

  it('reads two licences as two numbered sections', () => {
    const bizProfile: ApplicantProfile = {
      applicantType: 'business', country: 'US', state: 'GA',
      wantsGsa: false, licenses: ['dealer', 'salvage'], addressDiffersFromId: false,
      idForm: 'drivers_license',
      bizCountry: null,
    }
    const s = createApplication('app-2', bizProfile, OWNER)
    render(<ApplicationPanel state={s} />)

    const first = screen.getByRole('region', { name: /^license 1$/i })
    const second = screen.getByRole('region', { name: /^license 2$/i })
    expect(within(first).getByRole('group', { name: /^license number 1$/i })).toBeInTheDocument()
    expect(within(second).getByRole('group', { name: /^license number 2$/i })).toBeInTheDocument()
    expect(within(first).queryByRole('group', { name: /^license number 2$/i })).toBeNull()
  })

  it('renders a distinct row per licence instance and confirms the right one', async () => {
    // A business holding two licences owes `license_number#0` and
    // `license_number#1` — two separate rows, not one shared row. Confirming
    // the second must not silently confirm the first.
    const onConfirm = vi.fn()
    const bizProfile: ApplicantProfile = {
      applicantType: 'business', country: 'US', state: 'GA',
      wantsGsa: false, licenses: ['dealer', 'salvage'], addressDiffersFromId: false,
      idForm: 'drivers_license',
      bizCountry: null,
    }
    let s = createApplication('app-2', bizProfile, OWNER)
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'license_number#0', value: 'GA-DLR-1',
      source: 'ocr', at: AT,
    })
    s = applicationReducer(s, {
      type: 'SET_VALUE', fieldId: 'license_number#1', value: 'GA-SLV-2',
      source: 'ocr', at: AT,
    })
    render(<ApplicationPanel state={s} onConfirm={onConfirm} />)

    // Each instance gets a distinct, numbered accessible name (License
    // number 1 / License number 2) — not a shared "License number" name,
    // and not the unrelated "Driver's license number" (dl_number).
    const firstRow = screen.getByRole('group', { name: /^license number 1$/i })
    const secondRow = screen.getByRole('group', { name: /^license number 2$/i })
    expect(firstRow).toBeInTheDocument()
    expect(secondRow).toBeInTheDocument()

    // Click "Looks right" within the second licence row specifically, so a
    // bug that always confirms the first instance would be caught.
    await userEvent.click(within(secondRow).getByRole('button', { name: /looks right/i }))
    expect(onConfirm).toHaveBeenCalledWith('license_number#1')
  })
})
