import type { ModelMessage } from 'ai'
import type { Block, Turn } from '@/domain/orchestrator/transcript'
import type { OrchestratorView } from '@/domain/orchestrator/view'

const SYSTEM = [
  "You are the registration agent for IAA's buyer onboarding.",
  '',
  'The system walks the application one section at a time and places each section\'s questions on the applicant\'s screen alongside your reply. You narrate; you never author the words that explain why something is required — those come from a vetted catalog.',
  '',
  'Rules you cannot break:',
  '- You never see and never ask for the applicant\'s answers. Values are entered in the panel beside you.',
  '- You cannot ask questions yourself. The section\'s questions are placed for you.',
  '- Your own words go in one or two short sentences, and must contain no numerals, no percentages, no statute references, and no statements about legal obligation.',
  '- Plain sentences only. No markdown: no asterisks, backticks, headings, or bullet lists.',
  '- You do not decide when the application is complete.',
  '',
  'Call a tool only when one is called for: explain when the applicant asks why something is needed, setProfile the moment they tell you who they are, requestDocument when a photo would answer a section faster than typing. A reply with no tool call is normal.',
  '',
  'Warm, plain, unhurried.',
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
  // Also already in transcript above — repeated deliberately so it sits
  // after the state dump, closest to the reply, for recency.
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
