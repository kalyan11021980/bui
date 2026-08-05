import { generateText, type LanguageModel } from 'ai'
import { outstandingFields } from '@/domain/application/queries'
import type { Action, ApplicationState } from '@/domain/application/state'
import { guardToolCall, type RejectionCode } from '@/domain/orchestrator/guard'
import type { Block, Turn } from '@/domain/orchestrator/transcript'
import { lintVoice } from '@/domain/orchestrator/voice-lint'
import type { OrchestratorView } from '@/domain/orchestrator/view'
import type { DocType } from '@/domain/field-id'
import { docTypeBacksSensitiveField, fieldDef } from '@/domain/catalog'
import { parseReqKey } from '@/domain/requirements/key'
import { LOCAL_PROVIDER_NAME } from './model'
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
    // A local reasoning model spends most of its output on thinking nobody
    // sees, so effort is worth setting on both paths, not just anthropic's.
    providerOptions: request.isAnthropic
      ? { anthropic: { effort: request.effort } }
      : { [LOCAL_PROVIDER_NAME]: { reasoningEffort: request.effort } },
  })

  const blocks: Block[] = []
  const actions: Action[] = []
  const rejections: RejectionCode[] = []

  // History is never pruned, so a field asked on an earlier turn is still an
  // open box on screen — asking again just renders a second copy of it.
  const asked = new Set(request.transcript.flatMap((t) =>
    t.role === 'agent'
      ? t.blocks.flatMap((b) => (b.kind === 'field_ask' ? [b.fieldId] : []))
      : [],
  ))
  let droppedReAsk = false

  for (const call of result.toolCalls) {
    const outcome = guardToolCall(
      { toolName: call.toolName, input: call.input },
      request.state, request.uploadedDocs, request.at,
    )
    if (!outcome.ok) { rejections.push(outcome.code); continue }
    for (const block of outcome.blocks) {
      if (block.kind === 'field_ask' && asked.has(block.fieldId)) {
        rejections.push('already_asked')
        droppedReAsk = true
        continue
      }
      if (block.kind === 'field_ask') asked.add(block.fieldId)
      blocks.push(block)
    }
    actions.push(...outcome.actions)
  }

  // Gated on blocks alone: an accepted setProfile renders nothing, so a
  // turn with only actions is still an empty screen without this fallback.
  // A dropped re-ask skips the notice — the model did not whiff, it repeated
  // itself — and the turn moves forward to the next unasked field instead.
  // If everything outstanding is already on screen, the turn stays empty.
  if (blocks.length === 0) {
    if (!droppedReAsk) blocks.push({ kind: 'notice', copyId: 'guard_fallback' })
    const next = outstandingFields(request.state).find((id) => !asked.has(id))
    if (next) blocks.push({ kind: 'field_ask', fieldId: next })
  }

  const voice = decideVoice(result.text, blocks)

  // A sensitive turn drops its voice, but a wordless form reads as a broken
  // page. The vetted fallback line stands in until legally-reviewed copy for
  // this case exists — chosen over silence on 2026-08-05, not invented here.
  if (
    voice.dropped === 'sensitive'
    && !blocks.some((b) => b.kind === 'notice' && b.copyId === 'guard_fallback')
  ) {
    blocks.unshift({ kind: 'notice', copyId: 'guard_fallback' })
  }

  const seq = request.transcript.reduce((max, t) => Math.max(max, t.seq), 0) + 1

  return {
    turn: {
      seq,
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
  // A rationale is as much "about a sensitive field" as an ask for it, and a
  // document_request that backs one (e.g. proof_of_residency, or an ID photo
  // that backs dl_number/id_number/passport_number/dob) is too.
  const touchesSensitive = blocks.some((b) => {
    if (b.kind === 'field_ask' || b.kind === 'rationale') {
      return fieldDef(parseReqKey(b.fieldId).fieldId).sensitive === true
    }
    if (b.kind === 'document_request') return docTypeBacksSensitiveField(b.docType)
    return false
  })
  if (touchesSensitive) return { text: null, dropped: 'sensitive' }

  const trimmed = text.trim()
  if (trimmed === '') return { text: null }
  return lintVoice(trimmed).ok ? { text: trimmed } : { text: null, dropped: 'lint' }
}
