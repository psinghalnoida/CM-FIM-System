import "server-only";
// M30: the real Mitra adapter — official @anthropic-ai/sdk, never raw
// HTTP. Fails closed at construction if ANTHROPIC_API_KEY isn't set
// (same "adapters without real credentials fail closed" convention as
// OCR_PROVIDER/EMAIL_PROVIDER). Manual tool-use loop, not the SDK's
// beta Tool Runner: the tool set is small, fixed, and already bundles
// its own `run()` (lib/assistant/tools.ts), so hand-rolling the
// request → tool_use → tool_result → repeat cycle is a handful of lines
// and avoids taking on a beta dependency for something this scoped —
// see the claude-api skill's "Claude API — manual loop" tier.
//
// Model defaults to claude-opus-5 (this codebase's Claude-API-usage
// convention: default to the latest/most-capable model unless told
// otherwise) but is overridable via ASSISTANT_MODEL — JBM may want a
// cheaper/faster model for a simple internal Q&A widget once this is
// live; that's a config change, not a code change. effort:"low" is set
// explicitly: this is small-tool structured lookups, not open-ended
// reasoning, so the cheaper/faster end of the scale fits — raise it if
// answer quality on real traffic says otherwise.
//
// Not live-tested in this sandbox: no ANTHROPIC_API_KEY is available
// here (same situation the OCR milestone was in with AWS credentials
// for a real Textract adapter). Verified via
// lib/assistant/claude-provider.test.ts with the Anthropic client
// mocked — the tool-use loop, error/refusal handling, and iteration cap
// are all exercised without a real network call. Live verification
// needs a real key in an environment that has one.

import Anthropic from "@anthropic-ai/sdk";
import type { AuthSession } from "@/lib/dal";
import type {
  AssistantProvider,
  AssistantMessage,
  AssistantToolCall,
} from "@/lib/assistant/provider";
import type { AssistantTool } from "@/lib/assistant/tools";

const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are Mitra, the read-only assistant inside CM FIM System — a Fleet \
Incident & Insurance Claim Management System. You can search for and look \
up incidents, claims, and vehicles by number/registration/id, and check \
the caller's own My Work queue. You never write, edit, or change \
anything — you only look things up and explain them. If a tool result \
contains an "error" field, explain the problem plainly (e.g. "not found" \
or "you don't have access to that") rather than inventing an answer. Keep \
answers concise and grounded only in what the tools actually returned.`;

export class ClaudeAssistantProvider implements AssistantProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — required for ASSISTANT_PROVIDER=claude.",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = process.env.ASSISTANT_MODEL ?? "claude-opus-5";
  }

  async chat(
    session: AuthSession,
    messages: AssistantMessage[],
    tools: AssistantTool[],
  ): Promise<{ reply: string; toolCalls: AssistantToolCall[] }> {
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const toolCalls: AssistantToolCall[] = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        output_config: { effort: "low" },
        messages: anthropicMessages,
        tools: anthropicTools,
      });

      if (response.stop_reason === "refusal") {
        return {
          reply: "I can't help with that request.",
          toolCalls,
        };
      }

      if (response.stop_reason !== "tool_use") {
        const reply = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { reply: reply || "(no response)", toolCalls };
      }

      anthropicMessages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const tool = tools.find((t) => t.name === block.name);
        const result = tool
          ? await tool.run(session, block.input)
          : { error: `Unknown tool "${block.name}".` };
        toolCalls.push({ name: block.name, args: block.input, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      anthropicMessages.push({ role: "user", content: toolResults });
    }

    return {
      reply:
        "I wasn't able to finish looking that up — try rephrasing, or ask about one thing at a time.",
      toolCalls,
    };
  }
}
