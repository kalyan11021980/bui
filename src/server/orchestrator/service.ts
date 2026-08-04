import { generateText, type LanguageModel } from 'ai'
import { outstandingFields } from '@/domain/application/queries'
import type { Action, ApplicationState } from '@/domain/application/state'
import { guardToolCall, type RejectionCode } from '@/domain/orchestrator/guard'
import type { Block, Turn } from '@/domain/orchestrator/transcript'
import { lintVoice } from '@/domain/orchestrator/voice-lint'
import type { OrchestratorView } from '@/domain/orchestrator/view'
import type { DocType } from '@/domain/field-id'
import { fieldDef } from '@/domain/catalog'
import { parseReqKey } from '@/domain/requirements/key'
import { messagesFor, systemPrompt } from './prompt'
import { activeToolsFor, buildToolSet } from './tool-set'

export type TurnRequest = {
  model: LanguageModel
  view: OrchestratorView
  state: ApplicationState
  transcript: readonly Turn[]
  uploadedDocs: readonly DocType[]
  userText: string | null
  isResume: boolean
  at: string
  effort: string
  isAnthropic: boolean
}

export type TurnResult = {
  turn: Turn
  actions: readonly Action[]
  rejections: readonly RejectionCode[]
}

/**
 * Runs one turn: a single model call (generateText's default stopWhen is
 * isStepCount(1) — no agentic loop), guards every tool call it returns, then
 * lints or suppresses the voice. Never dead-ends: if nothing survives the
 * guard, a vetted fallback plus the next outstanding ask fill the turn.
 */
export async function runTurn(request: TurnRequest): Promise<TurnResult> {
  const result = await generateText({
    model: request.model,
    system: systemPrompt(),
    messages: messagesFor(request.view, request.transcript, request.userText),
    tools: buildToolSet(),
    activeTools: activeToolsFor(request.view, request.isResume),
    ...(request.isAnthropic && {
      providerOptions: { anthropic: { effort: request.effort } },
    }),
  })

  const blocks: Block[] = []
  const actions: Action[] = []
  const rejections: RejectionCode[] = []

  for (const call of result.toolCalls) {
    const outcome = guardToolCall(
      { toolName: call.toolName, input: call.input },
      request.state, request.uploadedDocs, request.at,
    )
    if (!outcome.ok) { rejections.push(outcome.code); continue }
    blocks.push(...outcome.blocks)
    actions.push(...outcome.actions)
  }

  if (blocks.length === 0 && actions.length === 0) {
    blocks.push({ kind: 'notice', copyId: 'guard_fallback' })
    const [next] = outstandingFields(request.state)
    if (next) blocks.push({ kind: 'field_ask', fieldId: next })
  }

  const voice = decideVoice(result.text, blocks)

  return {
    turn: {
      seq: request.transcript.length + 1,
      at: request.at,
      role: 'agent',
      voice: voice.text,
      ...(voice.dropped !== undefined && { voiceDropped: voice.dropped }),
      blocks,
    },
    actions,
    rejections,
  }
}

function decideVoice(
  text: string,
  blocks: readonly Block[],
): { text: string | null; dropped?: 'lint' | 'sensitive' } {
  const asksSensitive = blocks.some(
    (b) => b.kind === 'field_ask' && fieldDef(parseReqKey(b.fieldId).fieldId).sensitive === true,
  )
  if (asksSensitive) return { text: null, dropped: 'sensitive' }

  const trimmed = text.trim()
  if (trimmed === '') return { text: null }
  return lintVoice(trimmed).ok ? { text: trimmed } : { text: null, dropped: 'lint' }
}
