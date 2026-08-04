import { MockLanguageModelV4 } from 'ai/test'

export type StubCall = { toolName: string; input: unknown }

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}

/**
 * `LanguageModelV4ToolCall.input` is a JSON *string* on the wire; generateText
 * parses it before handing it to us. The stub must therefore stringify.
 */
export function stubModel(text: string, calls: readonly StubCall[] = []) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
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
    }),
  })
}
