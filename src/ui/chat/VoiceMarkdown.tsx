'use client'

import Markdown, { type Components } from 'react-markdown'

/**
 * Links are stripped to their text: the agent's voice is vetted copy and must
 * never link the applicant off-site. Raw HTML is not rendered (react-markdown
 * ships no rehype-raw), so this plus the lint's no-numerals / no-legal-claim
 * rules is the whole safety surface.
 */
const components: Components = {
  a: ({ children }) => <>{children}</>,
}

/**
 * Renders the agent's voice as markdown. Styling mirrors the plain `<p>` it
 * replaced: 15px, relaxed leading, no top margin on the first block, a small
 * gap between blocks, and dash bullets for lists.
 */
export function VoiceMarkdown({ voice }: { voice: string }) {
  return (
    <div className="text-[15px] leading-relaxed [&>*]:mt-2 [&>*:first-child]:mt-0 [&_ul]:m-0 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold">
      <Markdown components={components}>{voice}</Markdown>
    </div>
  )
}