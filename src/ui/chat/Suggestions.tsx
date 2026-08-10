'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { displayLabel } from '@/ui/panel/label'

type Props = {
  /** The field the active section is asking now, or null once nothing is outstanding. */
  currentField: RequirementKey | null
  disabled: boolean
  onPick: (text: string) => void
}

const chipClass =
  'cursor-pointer rounded-full border border-divider bg-surface px-3 py-1.5 text-left text-[13px] text-text-secondary hover:bg-page'

/**
 * A question-shaped label ("Which ID will you use?") already carries its
 * own question mark and reads as nonsense lowercased into "need my…" — it
 * is quoted back instead, so nothing is folded or doubled.
 */
function whyChip(fieldId: RequirementKey): string {
  const label = displayLabel(fieldId)
  return label.endsWith('?') ? `Why do you ask “${label}”` : `Why do you need my ${label.toLowerCase()}?`
}

/**
 * The chips track the section the applicant is in, not a fixed list: a
 * why-chip for the field they are on, then a next-step and a progress
 * prompt. Null once nothing is outstanding, so the composer is bare at the
 * completion moment (the CompletionCard takes over).
 *
 * The wording is built here from the field's own catalog label — it is not
 * model-authored and does not travel through a turn as text the agent chose.
 * Picking one sends it as ordinary intent, which is all it is: a question,
 * never an answer. Values are still only ever typed into a field.
 */
export function suggestionTexts(currentField: RequirementKey | null): string[] {
  if (currentField === null) return []
  return [whyChip(currentField), 'What’s my next step?', 'How much is left?']
}

export function Suggestions({ currentField, disabled, onPick }: Props) {
  if (disabled || currentField === null) return null

  return (
    <div aria-label="Things you could ask" className="mt-3 flex flex-wrap gap-2">
      {suggestionTexts(currentField).map((text) => (
        <button key={text} type="button" className={chipClass} onClick={() => onPick(text)}>
          {text}
        </button>
      ))}
    </div>
  )
}