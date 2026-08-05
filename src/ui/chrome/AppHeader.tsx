import { vettedCopy } from '@/domain/orchestrator/copy'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-divider bg-surface px-5 py-3">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-bold tracking-tight text-surface"
      >
        IAA
      </span>
      <span className="text-[15px] font-semibold">Buyer Registration</span>
      <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-divider bg-page px-3 py-1 text-[12px] text-text-secondary sm:flex">
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3Z" />
        </svg>
        {vettedCopy('header_reassurance')}
      </span>
    </header>
  )
}
