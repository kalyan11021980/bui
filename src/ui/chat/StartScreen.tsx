'use client'

import type { ApplicationState } from '@/domain/application/state'
import type { DocType } from '@/domain/field-id'
import { vettedCopy } from '@/domain/orchestrator/copy'
import type { RequirementKey } from '@/domain/requirements/key'
import type { PreparedImage } from '@/ui/panel/prepare-image'
import { OpeningUploadCard } from './OpeningUploadCard'
import { suggestionTexts } from './Suggestions'

type Props = {
  state: ApplicationState
  /** The fields still outstanding, most relevant first. */
  fieldIds: readonly RequirementKey[]
  /** Hidden, not greyed out, while sending is unavailable (§9.1). */
  disabled: boolean
  onPick: (text: string) => void
  onReadDocument: (docType: DocType, image: PreparedImage) => void
  readingDocTypes: readonly DocType[]
  /** Injectable: jsdom decodes no images and has no canvas. */
  prepare?: (file: File) => Promise<PreparedImage>
}

const cardClass =
  'cursor-pointer rounded-xl border border-divider bg-surface p-3 text-left '
  + 'text-[13px] text-text-secondary shadow-card hover:bg-page'

/**
 * The first thing a new applicant sees: a greeting, the license card, and a
 * few things to say. Gone for good after the first action docks the composer.
 */
export function StartScreen({
  state, fieldIds, disabled, onPick, onReadDocument, readingDocTypes, prepare,
}: Props) {
  return (
    <div className="flex flex-col gap-5" style={{ viewTransitionName: 'start-hero' }}>
      <div>
        <h1 className="m-0 text-[32px] font-semibold leading-tight">
          {vettedCopy('start_headline')}
        </h1>
        <p className="mb-0 mt-2 text-[15px] text-text-secondary">
          {vettedCopy('start_subline')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OpeningUploadCard
          state={state}
          onReadDocument={onReadDocument}
          readingDocTypes={readingDocTypes}
          variant="card"
          {...(prepare && { prepare })}
        />
        {!disabled && suggestionTexts(fieldIds).map((text) => (
          <button key={text} type="button" className={cardClass} onClick={() => onPick(text)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
