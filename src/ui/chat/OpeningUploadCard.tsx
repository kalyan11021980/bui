'use client'

import { useState } from 'react'
import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { documentsToUpload } from '@/domain/requirements/documents'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { DOC_LABEL, intakeFile } from '@/ui/upload/intake'

type Props = {
  state: ApplicationState
  onReadDocument: (docType: DocType, image: PreparedImage) => void
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}

/**
 * The opening beat promises "the fastest start is your driver's license";
 * this is where the license goes. Fixed UI, not a model turn — a cold model
 * cannot cost the applicant the entry point.
 */
export function OpeningUploadCard({ state, onReadDocument, prepare }: Props) {
  const [notice, setNotice] = useState<string | null>(null)
  // documentsToUpload always leads with profile.idForm, so the array is
  // never empty.
  const docType = documentsToUpload(state.profile)[0]!

  if (state.submittedAt !== null) return null
  if (state.documents.some((d) => d.docType === docType)) return null

  const handle = async (file: File | undefined) => {
    if (!file) return
    setNotice(null)
    await intakeFile(file, setNotice, (image) => onReadDocument(docType, image), prepare)
  }

  return (
    <div
      className="mb-3 rounded-xl border border-divider bg-surface p-4 shadow-card"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void handle(e.dataTransfer.files?.[0]) }}
    >
      <p className="m-0 text-[13px] font-semibold">{DOC_LABEL[docType]}</p>
      <p className="mb-3 mt-0.5 text-[12px] text-text-muted">
        {vettedCopy('upload_hint')}
      </p>
      <label
        htmlFor="opening-upload"
        className="inline-flex cursor-pointer items-center rounded-full bg-primary px-4 py-2 text-[14px] font-semibold text-surface"
      >
        Upload photo
      </label>
      <input
        id="opening-upload"
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => { void handle(e.target.files?.[0]) }}
      />
      <p className="mb-0 mt-2 text-[12px] text-text-muted">
        {vettedCopy('opening_upload_alternative')}
      </p>
      {notice && <p role="status" className="mb-0 mt-2 text-[12px]">{notice}</p>}
    </div>
  )
}
