import { MockLanguageModelV4 } from 'ai/test'

export type StubCall = { toolName: string; input: unknown }

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}

/**
 * `LanguageModelV4ToolCall.input` is a JSON *string* on the wire; generateText
 * parses it before handing it to us. The stub must therefore stringify.
 *
 * `onGenerate`, if given, runs before the canned response is returned — the
 * seam a test uses to simulate a write landing on the store while this call
 * is "in flight", the same window a real network round trip opens.
 */
export function stubModel(
  text: string,
  calls: readonly StubCall[] = [],
  onGenerate?: () => void,
) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      onGenerate?.()
      return {
        content: [
          { type: 'text' as const, text },
          ...calls.map((c, i) => ({
            type: 'tool-call' as const,
            toolCallId: `call-${i}`,
            toolName: c.toolName,
            input: JSON.stringify(c.input),
          })),
        ],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: USAGE,
        warnings: [],
      }
    },
  })
}
