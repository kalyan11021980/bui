'use client'

import { useState } from 'react'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
import { isComplete, outstandingFields } from '@/domain/application/queries'
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
    const result = applyCarry(
      applicationReducer(state, {
        type: 'SET_VALUE', fieldId: id, value, source: 'user', at,
      }),
      at,
    )
    setState(result.state)
    // Replaced on every edit, including with null — one left behind on a row
    // they have moved on from is a claim about the wrong keystroke. Computed
    // outside the state updater, which React may run twice.
    setCarry(carryNotice(id, result.applied))
  }

  const clear = (id: RequirementKey) => {
    const at = new Date().toISOString()
    const result = applyCarry(
      applicationReducer(state, { type: 'CLEAR_VALUE', fieldId: id, at }),
      at,
    )
    setState(result.state)
    setCarry(carryNotice(id, result.applied))
  }

  // "Fix this" moves the caret rather than mutating: the value is already
  // editable in place.
  const edit = (id: RequirementKey) => revealField(id)

  const outstanding = outstandingFields(state)
  const complete = isComplete(state)
  // The reducer refuses every change once submitted, so the panel must stop
  // offering edits it knows will be refused. Rows stay visible either way.
  const closed = state.submittedAt !== null

  // The button is never disabled. The reducer refuses an incomplete
  // submission; this check is so the panel can say what is missing instead.
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
        {...(!closed && {
          onConfirm: confirm, onEdit: edit, onChange: change, onClear: clear,
        })}
        {...(carry && !closed && { carry })}
      />

      {/* The attempt is always allowed; the answer is what is outstanding, or
          that the application is closed. */}
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
