export const READING_PHOTO = 'Reading your photo…'

/** The one shape every in-flight status takes — dots, then words. */
export function StatusLine({
  text, className = 'my-2 text-[13px] text-text-secondary',
}: { text: string; className?: string }) {
  return (
    <p role="status" className={className}>
      <span aria-hidden="true" style={{ letterSpacing: 2 }}>•••</span>{' '}
      {text}
    </p>
  )
}
