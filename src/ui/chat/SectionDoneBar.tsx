'use client'

import { outstandingFields } from '@/domain/application/queries'
import type { ApplicationState } from '@/domain/application/state'
import { lastPresentedSection } from '@/domain/orchestrator/plan'
import type { Turn } from '@/domain/orchestrator/transcript'
import type { Section } from '@/domain/section'

type Props = {
  state: ApplicationState
  /** This session's turns — where the newest presented section is read from. */
  turns: readonly Turn[]
  /** Refused, never disabled — focus must never be lost to a disabled control. */
  sendable: boolean
  onDone: (section: Section) => void
}

/**
 * Fixed UI like CompletionCard, which it yields to once nothing is
 * outstanding. Stays pressable with gaps — the server answers by marking
 * what's missing.
 */
export function SectionDoneBar({ state, turns, sendable, onDone }: Props) {
  if (state.submittedAt !== null) return null
  if (outstandingFields(state).length === 0) return null
  const section = lastPresentedSection(turns)
  if (section === null) return null

  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => { if (sendable) onDone(section) }}
        className="cursor-pointer rounded-full border border-divider bg-surface px-4 py-2 text-[14px] font-semibold text-primary"
      >
        Done with this section
      </button>
    </div>
  )
}
