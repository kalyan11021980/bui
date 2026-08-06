import type { ModelMessage } from 'ai'
import type { Block, Turn } from '@/domain/orchestrator/transcript'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const SYSTEM = [
  "You are the registration agent for IAA's buyer onboarding.",
  '',
  'You choose what to ask next and how to frame it. You never author the words that explain why something is required, what it is used for, or what it is legally for — those come from a vetted catalog and are rendered for you when you call a tool.',
  '',
  'Rules you cannot break:',
  '- You never see and never ask for the applicant\'s answers. Values are entered in the panel beside you.',
  '- You only ask for fields listed as outstanding. Asking for anything else is refused.',
  '- Your own words go in a short preamble only, and must contain no numerals, no percentages, no statute references, and no statements about legal obligation.',
  '- You do not decide when the application is complete.',
  '',
  // Left implicit until a local model was tried: a strong model infers it from
  // the rules above and calls a tool anyway, a smaller one writes prose and
  // shows the applicant a fallback notice every turn.
  'Every reply must include at least one tool call. Your preamble on its own puts nothing on the applicant\'s screen — the screen is built only from the tools you call. If there is nothing else to do, call askFor.',
  '',
  'Keep your preamble to one or two short sentences. Warm, plain, unhurried.',
].join('\n')

export function systemPrompt(): string {
  return SYSTEM
}

export function messagesFor(
  view: OrchestratorView,
  transcript: readonly Turn[],
  userText: string | null,
): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (const turn of transcript) {
    if (turn.role === 'applicant') {
      if (turn.text) messages.push({ role: 'user', content: turn.text })
      continue
    }
    const parts = [turn.voice, describeBlocks(turn.blocks)].filter(Boolean)
    if (parts.length > 0) messages.push({ role: 'assistant', content: parts.join('\n') })
  }

  messages.push({ role: 'user', content: renderView(view) })
  if (userText) messages.push({ role: 'user', content: userText })
  return messages
}

/** Identifiers only. The resolved copy is not sent — it is bulk with no value here. */
function describeBlocks(blocks: readonly Block[]): string {
  if (blocks.length === 0) return ''
  const parts = blocks.map((b) => {
    switch (b.kind) {
      case 'field_ask': return `asked for: ${b.fieldId}`
      case 'rationale': return `explained: ${b.fieldId}`
      case 'document_request': return `requested document: ${b.docType}`
      case 'orientation': return 'showed progress'
      case 'notice': return `showed notice: ${b.copyId}`
      case 'section_header':
        return `presented section: ${b.section} (${b.done} of ${b.total} answered)`
    }
  })
  return `[${parts.join('; ')}]`
}

function renderView(view: OrchestratorView): string {
  return [
    'Current state of this application:',
    JSON.stringify({
      profile: view.profile,
      outstanding: view.outstanding,
      settled: view.settled.map((f) => f.id),
      documentsOutstanding: view.documentsOutstanding,
    }, null, 2),
  ].join('\n')
}
