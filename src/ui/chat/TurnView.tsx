'use client'

import type { ApplicationState } from '@/domain/application/state'
import type { Turn } from '@/domain/orchestrator/transcript'
import { BlockView, type BlockHandlers } from './blocks'

type Props = BlockHandlers & {
  turn: Turn
  state: ApplicationState
}

/**
 * One turn. An applicant turn renders only what they typed — intent, never
 * data, and never a block. An agent turn renders its voice, when present,
 * then its blocks; a dropped or absent voice renders nothing in its place —
 * no placeholder, no empty bubble.
 */
export function TurnView({ turn, state, onChange, onClear, onConfirm, onReadDocument }: Props) {
  if (turn.role === 'applicant') {
    // No entrance animation: this bubble is the applicant's own act, shown
    // the instant they send — and the optimistic echo is remounted under its
    // committed seq when the reply lands, which would replay it.
    return (
      <p className="my-3 ml-auto w-fit max-w-[75%] rounded-2xl rounded-br-md border border-divider bg-surface px-4 py-2 text-[15px] leading-normal">
        {turn.text}
      </p>
    )
  }

  // A turn whose every ask was already on screen ends up empty — nothing to
  // show, so no spaced empty div either.
  if (turn.voice === null && turn.blocks.length === 0) return null

  return (
    <div className="animate-rise my-3 flex gap-3">
      {/* The agent's mark. Decorative — the log's structure already says who speaks. */}
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-primary text-[9px] font-bold text-surface"
      >
        IAA
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {turn.voice !== null && (
          <p className="m-0 text-[15px] leading-relaxed">{turn.voice}</p>
        )}
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
    </div>
  )
}
