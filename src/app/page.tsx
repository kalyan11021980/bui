'use client'

import { useState } from 'react'
import { outstandingFields } from '@/domain/application/queries'
import type { DocType } from '@/domain/field-id'
import { useApplication } from '@/ui/client/useApplication'
import { ProfileControls } from '@/ui/demo/ProfileControls'
import { ApplicationPanel } from '@/ui/panel/ApplicationPanel'
import { DocumentUpload } from '@/ui/panel/DocumentUpload'
import { revealField } from '@/ui/panel/reveal'
import { COLOR } from '@/ui/theme/tokens'

const STARTING = 'Setting up your application…'
const OUT_OF_STEP =
  'One of your answers has not been saved yet. Everything you typed is still on '
  + 'screen — check it before you send.'

const notice: React.CSSProperties = {
  maxWidth: 560, marginTop: 12, padding: '10px 14px', fontSize: 14,
  color: COLOR.textPrimary,
}

export default function Page() {
  const app = useApplication()
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const state = app.state

  if (!state) {
    return (
      <main style={{ padding: 24 }}>
        <p role="status" style={notice}>{app.notice ?? STARTING}</p>
      </main>
    )
  }

  const outstanding = outstandingFields(state)
  // The reducer refuses every change once submitted, so the panel must stop
  // offering edits it knows will be refused. Rows stay visible either way.
  const closed = state.submittedAt !== null

  // The button is never disabled. The panel says what is missing instead.
  const submit = () => {
    setAttemptedSubmit(true)
    app.submit()
  }

  // One document, named by the ID the applicant said they hold: asking a
  // passport holder to choose "passport" again is a question we already have
  // the answer to.
  const docType: DocType = state.profile.idForm

  return (
    <main style={{ padding: 24 }}>
      <ProfileControls
        profile={state.profile}
        onChange={app.updateProfile}
        disabled={closed}
      />

      <DocumentUpload
        docType={docType}
        onRead={(image) => app.readDocument(docType, image)}
        onChoose={app.forgetDocumentNotice}
        disabled={closed}
      />

      {app.notice && (
        <p role="status" style={{ ...notice, background: COLOR.surface }}>
          {app.notice}
        </p>
      )}

      {app.outOfStep && (
        <p role="alert" style={{ ...notice, background: COLOR.errorSurface }}>
          {OUT_OF_STEP}
        </p>
      )}

      <ApplicationPanel
        state={state}
        onSubmit={submit}
        {...(!closed && {
          onConfirm: app.confirm,
          // "Fix this" moves the caret rather than mutating: the value is
          // already editable in place.
          onEdit: revealField,
          onChange: app.change,
          onClear: app.clear,
        })}
        {...(app.carry && !closed && { carry: app.carry })}
        {...(app.document && {
          documentUrl: app.document.url, documentSize: app.document.size,
        })}
      />

      {/* The attempt is always allowed; the answer is what is outstanding, or
          that the application is closed. */}
      {(attemptedSubmit || closed) && (
        <p
          role="status"
          style={{
            ...notice,
            background: closed ? COLOR.successSurface : COLOR.errorSurface,
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
