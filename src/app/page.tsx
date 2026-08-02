'use client'

import { useState } from 'react'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { fieldInputId } from '@/ui/panel/FieldInput'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
import { applyCarry } from '@/domain/application/carry'
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

  const confirm = (id: RequirementKey) =>
    setState((s) =>
      applicationReducer(s, {
        type: 'CONFIRM',
        fieldId: id,
        at: new Date().toISOString(),
        shownCopyHash: 'catalog-v1',
      }),
    )

  const change = (id: RequirementKey, value: unknown) =>
    setState((s) => {
      const at = new Date().toISOString()
      // Carry runs on every edit, so filling in a home address populates the
      // business address as it is typed rather than at some later checkpoint
      // the applicant has to go and find. Spec §9.
      return applyCarry(
        applicationReducer(s, {
          type: 'SET_VALUE', fieldId: id, value, source: 'user', at,
        }),
        at,
      ).state
    })

  // "Fix this" moves the caret to the field rather than mutating anything:
  // the value is already editable in place, so an edit action would add a
  // state transition with nothing to show for it.
  const edit = (id: RequirementKey) =>
    document.getElementById(fieldInputId(id))?.focus()

  const outstanding = outstandingFields(state)
  const complete = isComplete(state)

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
        onConfirm={confirm}
        onEdit={edit}
        onChange={change}
        onSubmit={submit}
      />

      {/* Submitting while incomplete is allowed to be ATTEMPTED — the button
          is never disabled (§9). What it does is tell the truth about what is
          still outstanding, rather than going grey and explaining nothing. */}
      {attemptedSubmit && (
        <p
          role="status"
          style={{
            maxWidth: 560, marginTop: 12, padding: '10px 14px', fontSize: 14,
            background: state.submittedAt !== null ? COLOR.successSurface : COLOR.errorSurface,
            color: COLOR.textPrimary,
          }}
        >
          {state.submittedAt !== null
            ? 'Sent for review. Buyer Services will be in touch.'
            : `Not sent yet — ${outstanding.length} ${outstanding.length === 1 ? 'answer is' : 'answers are'} still needed above.`}
        </p>
      )}
    </main>
  )
}
