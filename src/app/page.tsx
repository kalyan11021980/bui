'use client'

import { useState } from 'react'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { applicationReducer, createApplication } from '@/domain/application/reducer'
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

  const confirm = (id: RequirementKey) =>
    setState((s) =>
      applicationReducer(s, {
        type: 'CONFIRM',
        fieldId: id,
        at: new Date().toISOString(),
        shownCopyHash: 'catalog-v1',
      }),
    )

  return (
    <main style={{ padding: 24 }}>
      <ApplicationPanel state={state} onConfirm={confirm} />
    </main>
  )
}
