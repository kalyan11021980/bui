'use client'

import { useEffect, useState } from 'react'
import { outstandingFields } from '@/domain/application/queries'
import { documentsToUpload } from '@/domain/requirements/documents'
import { AppHeader } from '@/ui/chrome/AppHeader'
import { ConversationShell } from '@/ui/chat/ConversationShell'
import { useApplication } from '@/ui/client/useApplication'
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

/**
 * The panel is the whole form on one surface. It is a debug view now, not the
 * product: the chat is what the applicant registers through, and two live
 * renderers of the same field put the same question on screen twice.
 */
function useDebug(): boolean {
  const [debug, setDebug] = useState(false)
  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).has('debug'))
  }, [])
  return debug
}

export default function Page() {
  const app = useApplication()
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const debug = useDebug()
  const state = app.state

  if (!state) {
    return (
      <>
        <AppHeader />
        <main style={{ padding: 24 }}>
          <p role="status" style={notice}>{app.notice ?? STARTING}</p>
        </main>
      </>
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

  return (
    <>
      <AppHeader />
      <main style={{ padding: 24 }}>
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

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          {debug && (
            <div>
              {/* Was rendered at the top of the page, above the panel heading
                  and outside any container. It belongs with the form it feeds. */}
              {documentsToUpload(state.profile).map((docType) => (
                <DocumentUpload
                  key={docType}
                  docType={docType}
                  onRead={(image) => app.readDocument(docType, image)}
                  onChoose={app.forgetDocumentNotice}
                  disabled={closed}
                />
              ))}
            </div>
          )}

          {debug && (
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
                onProfileChange: app.updateProfile,
              })}
              {...(app.carry && !closed && { carry: app.carry })}
              documents={app.documents}
            />
          )}

          <ConversationShell
            applicationId={state.id}
            ownerToken={app.ownerToken}
            state={state}
            onChange={app.change}
            onClear={app.clear}
            onConfirm={app.confirm}
            onReadDocument={app.readDocument}
            onState={app.adoptTurnState}
            runSerialized={app.runSerialized}
            panelWrites={app.panelWrites}
          />
        </div>

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
    </>
  )
}
