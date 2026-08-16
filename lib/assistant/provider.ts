import "server-only";
// M30: the AssistantProvider contract, fixed in docs/SCOPE.md section 5 —
// same pattern as OCRProvider (M11)/EmailProvider (M13): downstream code
// (app/api/mitra/chat/route.ts) codes against this stable shape
// regardless of which implementation is configured. Resolved via
// ASSISTANT_PROVIDER — never a hardcoded import in domain code.

import type { AuthSession } from "@/lib/dal";
import type { AssistantTool } from "@/lib/assistant/tools";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantToolCall {
  name: string;
  args: unknown;
  result: unknown;
}

export interface AssistantProvider {
  chat(
    session: AuthSession,
    messages: AssistantMessage[],
    tools: AssistantTool[],
  ): Promise<{ reply: string; toolCalls: AssistantToolCall[] }>;
}

/**
 * Resolves the configured provider. "stub" (the default) is a real,
 * committed implementation — deterministic, no external calls, no API
 * key needed. "claude" is the real thing (needs ANTHROPIC_API_KEY);
 * asking for anything else today fails closed rather than silently
 * falling back to fake data.
 */
export async function getAssistantProvider(): Promise<AssistantProvider> {
  const providerName = process.env.ASSISTANT_PROVIDER ?? "stub";
  if (providerName === "stub") {
    const { StubAssistantProvider } = await import("@/lib/assistant/stub-provider");
    return new StubAssistantProvider();
  }
  if (providerName === "claude") {
    const { ClaudeAssistantProvider } = await import("@/lib/assistant/claude-provider");
    return new ClaudeAssistantProvider();
  }
  throw new Error(
    `Unknown ASSISTANT_PROVIDER "${providerName}" — no adapter implements it yet.`,
  );
}
