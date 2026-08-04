import { tool, type ToolSet } from 'ai'
import { TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type ToolName } from '@/domain/orchestrator/tools'
import type { OrchestratorView } from '@/domain/orchestrator/view'

/**
 * No tool carries an execute function. The SDK returns the calls and
 * guardToolCall decides — an execute here would be a second, unguarded path
 * into the application.
 */
export function buildToolSet(): ToolSet {
  return {
    askFor: tool({ description: TOOL_DESCRIPTIONS.askFor, inputSchema: TOOL_SCHEMAS.askFor }),
    explain: tool({ description: TOOL_DESCRIPTIONS.explain, inputSchema: TOOL_SCHEMAS.explain }),
    setProfile: tool({
      description: TOOL_DESCRIPTIONS.setProfile, inputSchema: TOOL_SCHEMAS.setProfile,
    }),
    requestDocument: tool({
      description: TOOL_DESCRIPTIONS.requestDocument, inputSchema: TOOL_SCHEMAS.requestDocument,
    }),
    orient: tool({ description: TOOL_DESCRIPTIONS.orient, inputSchema: TOOL_SCHEMAS.orient }),
  }
}

/** Narrows the offer to what is legal now. Defence in depth; the guard still runs. */
export function activeToolsFor(view: OrchestratorView, isResume: boolean): ToolName[] {
  // Past the rejection threshold the agent offers nothing of its own — the
  // applicant was told it would step back, so the model must not be able to
  // ask, explain, or file anything either.
  if (view.panelOnly) return []

  const active: ToolName[] = ['explain', 'setProfile']
  if (view.outstanding.length > 0) active.push('askFor')
  if (view.documentsOutstanding.length > 0) active.push('requestDocument')
  if (isResume) active.push('orient')
  return active
}
