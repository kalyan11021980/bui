'use client'

import { useState } from 'react'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { fieldInputId } from '@/ui/panel/FieldInput'
import {
  applicationReducer, createApplication, isComplete, outstandingFields,
} from '@/domain/application/reducer'
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
  const [submitted, setSubmitted] = useState(false)

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
    setState((s) =>
      applicationReducer(s, {
        type: 'SET_VALUE',
        fieldId: id,
        value,
        source: 'user',
        at: new Date().toISOString(),
      }),
    )

  // "Fix this" moves the caret to the field rather than mutating anything:
  // the value is already editable in place, so an edit action would add a
  // state transition with nothing to show for it.
  const edit = (id: RequirementKey) =>
    document.getElementById(fieldInputId(id))?.focus()

  const outstanding = outstandingFields(state)
  const complete = isComplete(state)

  return (
    <main style={{ padding: 24 }}>
      <ApplicationPanel
        state={state}
        onConfirm={confirm}
        onEdit={edit}
        onChange={change}
        onSubmit={() => setSubmitted(true)}
      />

      {/* Submitting while incomplete is allowed to be ATTEMPTED — the button
          is never disabled (§9). What it does is tell the truth about what is
          still outstanding, rather than going grey and explaining nothing. */}
      {submitted && (
        <p
          role="status"
          style={{
            maxWidth: 560, marginTop: 12, padding: '10px 14px', fontSize: 14,
            background: complete ? COLOR.successSurface : COLOR.errorSurface,
            color: COLOR.textPrimary,
          }}
        >
          {complete
            ? 'Sent for review. Buyer Services will be in touch.'
            : `Not sent yet — ${outstanding.length} ${outstanding.length === 1 ? 'answer is' : 'answers are'} still needed above.`}
        </p>
      )}
    </main>
  )
}
