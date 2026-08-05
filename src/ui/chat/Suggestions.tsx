'use client'

import type { RequirementKey } from '@/domain/requirements/key'
import { displayLabel } from '@/ui/panel/label'
import { COLOR } from '@/ui/theme/tokens'

type Props = {
  /** The fields still outstanding, most relevant first. */
  fieldIds: readonly RequirementKey[]
  disabled: boolean
  onPick: (text: string) => void
}

const chipStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 13, textAlign: 'left',
  color: COLOR.textPrimary, background: COLOR.surface,
  border: `1px solid ${COLOR.border}`, borderRadius: 14, cursor: 'pointer',
}

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

  const asks = fieldIds.slice(0, 2).map((id) => `Why do you need my ${displayLabel(id).toLowerCase()}?`)
  const offers = ['What else do you need?']

  return (
    <div
      aria-label="Things you could ask"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}
    >
      {[...asks, ...offers].map((text) => (
        <button key={text} type="button" style={chipStyle} onClick={() => onPick(text)}>
          {text}
        </button>
      ))}
    </div>
  )
}
