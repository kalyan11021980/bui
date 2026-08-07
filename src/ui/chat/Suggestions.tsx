'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { displayLabel } from '@/ui/panel/label'

type Props = {
  /** The fields still outstanding, most relevant first. */
  fieldIds: readonly RequirementKey[]
  disabled: boolean
  onPick: (text: string) => void
}

const chipClass =
  'cursor-pointer rounded-full border border-divider bg-surface px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-page'

/**
 * Something to say next, so the composer is never a blank prompt with no
 * indication of what this thing accepts.
 *
 * The wording is built here from the field's own catalog label — it is not
 * model-authored and does not travel through a turn as text the agent chose.
 * Picking one sends it as ordinary intent, which is all it is: a question,
 * never an answer. Values are still only ever typed into a field.
 */
export function Suggestions({ fieldIds, disabled, onPick }: Props) {
  if (disabled || fieldIds.length === 0) return null

  // A question-shaped label ("Which ID will you use?") already carries its
  // own question mark and reads as nonsense lowercased into "need my…" — it
  // is quoted back instead, so nothing is folded or doubled.
  const asks = fieldIds.slice(0, 2).map((id) => {
    const label = displayLabel(id)
    return label.endsWith('?') ? `Why do you ask “${label}”` : `Why do you need my ${label.toLowerCase()}?`
  })
  const offers = ['What else do you need?']

  return (
    <div aria-label="Things you could ask" className="mt-3 flex flex-wrap gap-2">
      {[...asks, ...offers].map((text) => (
        <button key={text} type="button" className={chipClass} onClick={() => onPick(text)}>
          {text}
        </button>
      ))}
    </div>
  )
}
