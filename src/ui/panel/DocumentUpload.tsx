'use client'

import { useState } from 'react'
import type { DocType } from '@/domain/field-id'
import { bandForWidth } from '@/domain/ocr/quality'
import { COLOR } from '@/ui/theme/tokens'
import { prepareImage, type PreparedImage } from './prepare-image'

const DOC_LABEL: Record<DocType, string> = {
  drivers_license: "Photo of your driver's license",
  state_id: 'Photo of your state ID',
  passport: 'Photo of your passport',
  dealer_license: 'Photo of your dealer license',
  proof_of_residency: 'Photo of your proof of address',
}

/** Same words the route uses, because it is the same refusal. */
const TOO_SMALL =
  'That photo is too small to read. Take another with the document filling the frame.'
const TEXT_ONLY =
  'We read it, but the photo is too small to show you where each answer came from.'
const UNOPENABLE =
  'We could not open that photo. Try another, or answer the questions below yourself.'

type Props = {
  docType: DocType
  onRead: (image: PreparedImage) => void
  disabled?: boolean
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}

export function DocumentUpload({ docType, onRead, disabled, prepare }: Props) {
  const [notice, setNotice] = useState<string | null>(null)
  const inputId = `upload-${docType}`

  const handle = async (file: File | undefined) => {
    if (!file) return

    let image: PreparedImage
    try {
      image = await (prepare ?? prepareImage)(file)
    } catch {
      setNotice(UNOPENABLE)
      return
    }

    // The re-encoded width, not the file's: the server gates on the same
    // bytes, so a photo waved past here would only be refused there.
    const band = bandForWidth(image.imageSize.width)
    if (band === 're-take') {
      setNotice(TOO_SMALL)
      return
    }

    // Replaced, never left standing: a notice about the previous photo
    // describes something no longer on offer.
    setNotice(band === 'text-only' ? TEXT_ONLY : null)
    onRead(image)
  }

  return (
    <div style={{ margin: '12px 0' }}>
      <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
        {DOC_LABEL[docType]}
      </label>
      <p style={{ fontSize: 12, color: COLOR.textMuted, margin: '2px 0 6px' }}>
        Lay it flat and fill the frame. We read what we can and ask you about the rest.
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
