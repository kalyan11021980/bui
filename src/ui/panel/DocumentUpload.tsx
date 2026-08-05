'use client'

import { useState } from 'react'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import { COLOR } from '@/ui/theme/tokens'
import { DOC_LABEL, TOO_SMALL, UNOPENABLE, judgeFile } from '@/ui/upload/intake'
import type { PreparedImage } from './prepare-image'

type Props = {
  docType: DocType
  onRead: (image: PreparedImage) => void
  /** Every choice of file, before it is judged — what was said about the last
   * one describes a photo that is no longer on offer. */
  onChoose?: () => void
  disabled?: boolean
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
  /**
   * Namespaces the id for a second renderer of the same document type — the
   * chat surface renders a `document_request` for a document the page-level
   * upload list may already offer. Omitted, this returns exactly what it
   * always has.
   */
  scope?: string
}

export function DocumentUpload({
  docType, onRead, onChoose, disabled, prepare, scope,
}: Props) {
  const [notice, setNotice] = useState<string | null>(null)
  const inputId = scope ? `${scope}-upload-${docType}` : `upload-${docType}`

  const handle = async (file: File | undefined) => {
    if (!file) return
    setNotice(null)
    onChoose?.()
    const verdict = await judgeFile(file, prepare)
    if (verdict.kind === 'unopenable') { setNotice(UNOPENABLE); return }
    if (verdict.kind === 're-take') { setNotice(TOO_SMALL); return }
    setNotice(verdict.notice)
    onRead(verdict.image)
  }

  return (
    <div style={{ margin: '12px 0' }}>
      <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
        {DOC_LABEL[docType]}
      </label>
      <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '2px 0 6px' }}>
        {vettedCopy('upload_hint')}
      </p>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        disabled={disabled ?? false}
        onChange={(e) => { void handle(e.target.files?.[0]) }}
      />
      {notice && (
        <p role="status" style={{ fontSize: 12, marginTop: 6, color: COLOR.textPrimary }}>
          {notice}
        </p>
      )}
    </div>
  )
}
