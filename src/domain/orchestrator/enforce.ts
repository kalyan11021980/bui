import { createParser, type ElementNode } from '@openuidev/lang-core'
import type { RequirementKey } from '../requirements/key'
import { BLOCK_COMPONENTS, agentLibrary } from './library'
import type { Block } from './transcript'

type SafeParse<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: { path: PropertyKey[] }[] } }

export type EnforceResult = {
  /** What survived, in the shape the audit trail and the panel already speak. */
  blocks: Block[]
  /** One code per refusal, for `orchestratorRejections` and the audit log. */
  rejections: string[]
}

const parser = createParser(agentLibrary.toJSONSchema(), 'Turn')

/**
 * Turns one openui-lang reply into vetted blocks.
 *
 * OpenUI drops a component it does not know, but it does not check prop
 * VALUES — `Notice("You are required by law to …")` parses clean and would
 * render those words verbatim. So every node is re-checked here against its
 * own Zod schema, and an `Ask` is additionally checked against what is
 * actually outstanding, which is the same rule the tool guard applied.
 *
 * A bad node is dropped, never fatal: one refused block must not cost the
 * applicant the rest of the turn.
 */
export function enforceTree(
  source: string,
  outstanding: readonly string[],
): EnforceResult {
  const rejections: string[] = []
  const blocks: Block[] = []
  const result = parser.parse(source)

  // A component OpenUI does not know is dropped before this code ever sees
  // it, so its refusal has to be read back off the parser — otherwise the
  // block vanishes from the screen with nothing in the audit trail saying so.
  for (const error of result.meta?.errors ?? []) {
    if (error.code === 'unknown-component') rejections.push(`unknown:${error.component}`)
    else rejections.push(`parse:${error.code}`)
  }

  const root = result.root
  const children = root?.props?.children

  for (const child of Array.isArray(children) ? children : []) {
    const block = checkNode(child as ElementNode, outstanding, rejections)
    if (block) blocks.push(block)
  }
  return { blocks, rejections }
}

function checkNode(
  node: ElementNode | null,
  outstanding: readonly string[],
  rejections: string[],
): Block | null {
  if (!node || node.type !== 'element') return null

  const name = node.typeName
  const raw = node.props ?? {}

  /**
   * Each component's own schema, named explicitly rather than looked up by
   * key: indexing the library widens the result to a union of every
   * component's props, and then nothing narrows.
   */
  function check<T>(
    schema: { safeParse: (value: unknown) => SafeParse<T> },
    label: string,
  ): T | null {
    const parsed = schema.safeParse(raw)
    if (parsed.success) return parsed.data
    rejections.push(`prop:${label}.${parsed.error.issues[0]?.path.join('.') ?? '?'}`)
    return null
  }

  /** The agent only ever asks for, or explains, something still needed. */
  const outstandingKey = (fieldId: string): RequirementKey | null => {
    if (outstanding.includes(fieldId)) return fieldId as RequirementKey
    rejections.push(`not_outstanding:${fieldId}`)
    return null
  }

  switch (name) {
    case 'Notice': {
      const p = check(BLOCK_COMPONENTS.Notice.props, 'Notice')
      return p && { kind: 'notice', copyId: p.copyId }
    }
    case 'Doc': {
      const p = check(BLOCK_COMPONENTS.Doc.props, 'Doc')
      return p && { kind: 'document_request', docType: p.docType }
    }
    case 'Progress': {
      const p = check(BLOCK_COMPONENTS.Progress.props, 'Progress')
      return p && { kind: 'orientation', done: p.done, total: p.total }
    }
    case 'Ask': {
      const p = check(BLOCK_COMPONENTS.Ask.props, 'Ask')
      const fieldId = p === null ? null : outstandingKey(p.fieldId)
      return fieldId === null ? null : { kind: 'field_ask', fieldId }
    }
    case 'Why': {
      const p = check(BLOCK_COMPONENTS.Why.props, 'Why')
      const fieldId = p === null ? null : outstandingKey(p.fieldId)
      return fieldId === null ? null : { kind: 'rationale', fieldId }
    }
    default:
      rejections.push(`unknown:${name}`)
      return null
  }
}
