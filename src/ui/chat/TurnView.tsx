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
  margin: 0, fontSize: 15, lineHeight: 1.5, color: COLOR.textPrimary,
}

/**
 * Right-aligned and filled, against the agent's left-aligned plain text.
 * Before this both roles rendered as the same grey paragraph at the same
 * left edge, and what you had just typed read as one more line of the
 * agent's own speech.
 */
const applicantBubble: React.CSSProperties = {
  margin: '12px 0 12px auto', padding: '8px 12px', maxWidth: '80%', width: 'fit-content',
  fontSize: 15, lineHeight: 1.4, color: COLOR.surface, background: COLOR.primary,
  borderRadius: 14, borderBottomRightRadius: 4,
}

const agentBlock: React.CSSProperties = {
  margin: '12px 0', display: 'flex', flexDirection: 'column', gap: 8,
}

/**
 * One turn. An applicant turn renders only what they typed — intent, never
 * data, and never a block. An agent turn renders its voice, when present,
 * then its blocks; a dropped or absent voice renders nothing in its place —
 * no placeholder, no empty bubble.
 */
export function TurnView({ turn, state, onChange, onClear, onConfirm, onReadDocument }: Props) {
  if (turn.role === 'applicant') {
    return <p style={applicantBubble}>{turn.text}</p>
  }

  // A nudge turn whose every ask was already on screen — nothing to show,
  // so no spaced empty div either.
  if (turn.voice === null && turn.blocks.length === 0) return null

  return (
    <div style={agentBlock}>
      {turn.voice !== null && <p style={voiceStyle}>{turn.voice}</p>}
      {turn.blocks.map((block, index) => (
        <BlockView
          key={`${block.kind}-${index}`}
          block={block}
          state={state}
          seq={turn.seq}
          onChange={onChange}
          onClear={onClear}
          onConfirm={onConfirm}
          onReadDocument={onReadDocument}
        />
      ))}
    </div>
  )
}
