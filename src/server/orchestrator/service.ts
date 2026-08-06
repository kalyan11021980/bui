import { generateText, type LanguageModel } from 'ai'
import { applyCarry } from '@/domain/application/carry'
import { applicationReducer } from '@/domain/application/reducer'
import { outstandingFields } from '@/domain/application/queries'
import type { Action, ApplicationState } from '@/domain/application/state'
import { guardToolCall, type RejectionCode } from '@/domain/orchestrator/guard'
import { planTurnBlocks } from '@/domain/orchestrator/plan'
import type { Block, Turn } from '@/domain/orchestrator/transcript'
import { lintVoice } from '@/domain/orchestrator/voice-lint'
import type { OrchestratorView } from '@/domain/orchestrator/view'
import type { DocType } from '@/domain/field-id'
import { docTypeBacksSensitiveField, fieldDef } from '@/domain/catalog'
import { parseReqKey } from '@/domain/requirements/key'
import type { Section } from '@/domain/section'
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
  doneWith: Section | null
}

export type TurnResult = {
  turn: Turn
  actions: readonly Action[]
  rejections: readonly RejectionCode[]
}

/**
 * Runs one turn: a single model call (generateText's default stopWhen is
 * isStepCount(1) — no agentic loop), guards every tool call it returns, adds
 * the section the planner says belongs on screen, then lints or suppresses
 * the voice. Never dead-ends: a vetted fallback fills a turn with nothing to
 * show and nothing to say.
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

  for (const call of result.toolCalls) {
    const outcome = guardToolCall(
      { toolName: call.toolName, input: call.input },
      request.state, request.uploadedDocs, request.at,
    )
    if (!outcome.ok) { rejections.push(outcome.code); continue }
    blocks.push(...outcome.blocks)
    actions.push(...outcome.actions)
  }

  // The plan reads the state as it will be once this turn's actions commit —
  // a setProfile this turn reshapes what is asked this same turn.
  const planState = actions.reduce(
    (s, a) => applyCarry(applicationReducer(s, a), request.at).state,
    request.state,
  )
  blocks.push(...planTurnBlocks(planState, request.transcript, request.doneWith))

  const voice = decideVoice(result.text, blocks)

  // A turn with nothing to show and nothing to say reads as a broken page;
  // the vetted line stands in — unless nothing is outstanding, where it
  // would be false copy.
  if (blocks.length === 0 && voice.text === null
      && outstandingFields(planState).length > 0) {
    blocks.push({ kind: 'notice', copyId: 'guard_fallback' })
  }

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
