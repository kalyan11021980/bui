'use client'

import type { ApplicationState } from '@/domain/application/state'
import type { Turn } from '@/domain/orchestrator/transcript'
import { COLOR } from '@/ui/theme/tokens'
import { BlockView, type BlockHandlers } from './blocks'

type Props = BlockHandlers & {
  turn: Turn
  state: ApplicationState
}

const voiceStyle: React.CSSProperties = {
  margin: '4px 0 8px', fontSize: 15, color: COLOR.textPrimary,
}

const applicantStyle: React.CSSProperties = {
  margin: '4px 0 8px', fontSize: 15, color: COLOR.textSecondary, fontStyle: 'italic',
}

/**
 * One turn. An applicant turn renders only what they typed — intent, never
 * data, and never a block. An agent turn renders its voice, when present,
 * then its blocks; a dropped or absent voice renders nothing in its place —
 * no placeholder, no empty bubble.
 */
export function TurnView({ turn, state, onChange, onClear, onConfirm, onReadDocument }: Props) {
  if (turn.role === 'applicant') {
    return <p style={applicantStyle}>{turn.text}</p>
  }

  return (
    <div>
      {turn.voice !== null && <p style={voiceStyle}>{turn.voice}</p>}
      {turn.blocks.map((block, index) => (
        <BlockView
          key={`${block.kind}-${index}`}
          block={block}
          state={state}
          onChange={onChange}
          onClear={onClear}
          onConfirm={onConfirm}
          onReadDocument={onReadDocument}
        />
      ))}
    </div>
  )
}
