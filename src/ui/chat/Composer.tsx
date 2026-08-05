'use client'

import { useState } from 'react'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { documentsToUpload } from '@/domain/requirements/documents'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { DOC_LABEL, intakeFile } from '@/ui/upload/intake'

type Props = {
  sendable: boolean
  onSend: (text: string) => void
  state: ApplicationState
  onReadDocument: (docType: DocType, image: PreparedImage) => void
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}

const PAPERCLIP = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
)

export function Composer({ sendable, onSend, state, onReadDocument, prepare }: Props) {
  const [draft, setDraft] = useState('')
  const [chooserOpen, setChooserOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const outstanding = documentsToUpload(state.profile)
    .filter((t) => !state.documents.some((d) => d.docType === t))

  const handleFile = async (docType: DocType, file: File | undefined) => {
    if (!file) return
    setNotice(null)
    setChooserOpen(false)
    await intakeFile(file, setNotice, (image) => onReadDocument(docType, image), prepare)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!sendable) return
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    onSend(text)
  }

  return (
    <div>
      {notice && <p role="status" className="mb-2 mt-0 text-[12px]">{notice}</p>}
      {chooserOpen && outstanding.length > 1 && (
        <div
          id="composer-attach-chooser"
          className="mb-2 flex flex-col gap-1 rounded-xl border border-divider bg-surface p-2 shadow-card"
        >
          {outstanding.map((docType) => (
            <span key={docType}>
              <label
                htmlFor={`composer-attach-${docType}`}
                aria-label={`Attach a ${DOC_LABEL[docType].toLowerCase()}`}
                className="block cursor-pointer rounded-lg px-3 py-1.5 text-[13px] hover:bg-page"
              >
                {DOC_LABEL[docType]}
              </label>
              <input
                id={`composer-attach-${docType}`}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => { void handleFile(docType, e.target.files?.[0]) }}
              />
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={submit}
        className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-2 py-1.5 shadow-card"
      >
        {outstanding.length === 1 && (
          <>
            <label
              htmlFor="composer-attach"
              aria-label={`Attach a ${DOC_LABEL[outstanding[0]!].toLowerCase()}`}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary hover:bg-page"
            >
              {PAPERCLIP}
            </label>
            <input
              id="composer-attach"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => { void handleFile(outstanding[0]!, e.target.files?.[0]) }}
            />
          </>
        )}
        {outstanding.length > 1 && (
          <button
            type="button"
            aria-label="Attach a document"
            aria-expanded={chooserOpen}
            aria-controls="composer-attach-chooser"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text-secondary hover:bg-page"
            onClick={() => setChooserOpen((open) => !open)}
          >
            {PAPERCLIP}
          </button>
        )}

        <label htmlFor="chat-composer" className="sr-only">
          Tell the agent something
        </label>
        <input
          id="chat-composer"
          value={draft}
          placeholder={vettedCopy('composer_placeholder')}
          className="w-full border-none bg-transparent text-[15px] outline-none placeholder:text-text-muted"
          onChange={(event) => setDraft(event.target.value)}
        />

        <button
          type="submit"
          aria-label="Send"
          aria-disabled={!sendable || draft.trim() === ''}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-surface ${
            !sendable || draft.trim() === '' ? 'bg-primary opacity-60' : 'cursor-pointer bg-primary'
          }`}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21 23 12 2 3v7l15 2-15 2v7Z" />
          </svg>
        </button>
      </form>
    </div>
  )
}
