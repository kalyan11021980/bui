'use client'

import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import { vettedCopy } from '@/domain/orchestrator/copy'

type Props = {
  state: ApplicationState
  onSubmit: () => void
}

/**
 * The finish line, as fixed UI — like the opening card, it cannot depend on
 * a model turn. Renders only in the window between the last answer and the
 * submission; the never-disabled rule is satisfied by not rendering at all
 * while something is still outstanding, rather than by a dimmed button.
 */
export function CompletionCard({ state, onSubmit }: Props) {
  if (state.submittedAt !== null) return null
  if (outstandingFields(state).length > 0) return null

  return (
    <div role="status" className="animate-rise my-3 rounded-xl border border-divider bg-surface p-4 shadow-card">
      <p className="m-0 mb-3 text-[15px] leading-relaxed">
        {vettedCopy('completion_ready')}
      </p>
      <button
        type="button"
        onClick={onSubmit}
        className="cursor-pointer rounded-full border-none bg-primary px-4 py-2 text-[14px] font-semibold text-surface"
      >
        Send for review
      </button>
    </div>
  )
}
