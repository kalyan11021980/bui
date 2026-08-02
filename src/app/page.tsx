'use client'

import { useState } from 'react'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { fieldInputId } from '@/ui/panel/FieldInput'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
import { applyCarry, carryNotice, type CarryNotice } from '@/domain/application/carry'
import { revealField } from '@/ui/panel/reveal'
import { COLOR } from '@/ui/theme/tokens'
import type { RequirementKey } from '@/domain/requirements/key'
import type { ApplicantProfile } from '@/domain/requirements/rules'

const profile: ApplicantProfile = {
  applicantType: 'business',
  country: 'US',
  state: 'GA',
  wantsGsa: false,
  licenses: ['dealer'],
}

export default function Page() {
  const [state, setState] = useState(() => createApplication('demo', profile))
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [carry, setCarry] = useState<CarryNotice | null>(null)

  const confirm = (id: RequirementKey) =>
    setState((s) =>
      applicationReducer(s, {
        type: 'CONFIRM',
        fieldId: id,
        at: new Date().toISOString(),
        shownCopyHash: 'catalog-v1',
      }),
    )

  const change = (id: RequirementKey, value: unknown) => {
    const at = new Date().toISOString()
    // Carry runs on every edit, so filling in a home address populates the
    // business address as it is typed rather than at some later checkpoint
    // the applicant has to go and find. Spec §9.
    const result = applyCarry(
      applicationReducer(state, {
        type: 'SET_VALUE', fieldId: id, value, source: 'user', at,
      }),
      at,
    )
    setState(result.state)
    // Replaced on every edit, including with null: the acknowledgement belongs
    // to the LAST edit that actually saved the applicant something, and one
    // left behind on a row they have moved on from is a claim about the wrong
    // keystroke. Computed outside the state updater because updaters must stay
    // pure — React is entitled to run them twice.
    setCarry(carryNotice(id, result.applied))
  }

  // "Fix this" moves the caret to the field rather than mutating anything:
  // the value is already editable in place, so an edit action would add a
  // state transition with nothing to show for it.
  const edit = (id: RequirementKey) => revealField(id)

  const outstanding = outstandingFields(state)
  const complete = isComplete(state)
  // Once it is sent for review, the reducer refuses every change (F2). The
  // panel must not keep offering an edit it knows will be refused: a control
  // that responds to typing by throwing is worse than one that is not there,
  // and the rows stay visible and readable either way.
  const closed = state.submittedAt !== null

  // The button is never disabled, so the attempt is always allowed. The
  // reducer refuses an incomplete submission (§8.2); the check here is so the
  // panel can answer with what is missing instead of throwing at the user.
  const submit = () => {
    setAttemptedSubmit(true)
    if (!complete || state.submittedAt !== null) return
    setState((s) => applicationReducer(s, { type: 'SUBMIT', at: new Date().toISOString() }))
  }

  return (
    <main style={{ padding: 24 }}>
      <ApplicationPanel
        state={state}
        onSubmit={submit}
        {...(!closed && { onConfirm: confirm, onEdit: edit, onChange: change })}
        {...(carry && !closed && { carry })}
      />

      {/* Submitting while incomplete is allowed to be ATTEMPTED — the button
          is never disabled (§9). What it does is tell the truth about what is
          still outstanding, rather than going grey and explaining nothing.
          The same is true after submission: the attempt is allowed and the
          answer is that the application is closed. */}
      {(attemptedSubmit || closed) && (
        <p
          role="status"
          style={{
            maxWidth: 560, marginTop: 12, padding: '10px 14px', fontSize: 14,
            background: closed ? COLOR.successSurface : COLOR.errorSurface,
            color: COLOR.textPrimary,
          }}
        >
          {closed
            ? 'Sent for review — these answers can no longer be changed. '
              + 'Buyer Services will be in touch if anything needs correcting.'
            : `Not sent yet — ${outstanding.length} ${outstanding.length === 1 ? 'answer is' : 'answers are'} still needed above.`}
        </p>
      )}
    </main>
  )
}
