import "server-only";
// M30: deterministic stub — no external calls, no API key needed, same
// posture as StubOcrProvider (M11)/ConsoleEmailProvider (M13). Real
// pattern-matching + real tool execution against the caller's real
// session (not fake data) — just no LLM in the loop. Good enough to
// wire up and test the chat widget end-to-end before ASSISTANT_PROVIDER
// is ever set to "claude".

import type { AuthSession } from "@/lib/dal";
import type { AssistantProvider, AssistantMessage, AssistantToolCall } from "@/lib/assistant/provider";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";

const NUMBER_PATTERN = /\b(?:INC|CLM|SUR)-\d{4}-\d+\b/i;
// A vehicle registration doesn't have a fixed org-wide format (BR-06 never
// pinned one), so this is a loose heuristic: a bare alphanumeric token
// mixing letters and digits, distinct from the INC-/CLM- shape above —
// good enough for the stub to route to search_records; the real Claude
// provider doesn't need a regex, it reasons about the question directly.
const REGISTRATION_PATTERN = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,12}\b/;

export class StubAssistantProvider implements AssistantProvider {
  async chat(
    session: AuthSession,
    messages: AssistantMessage[],
    tools: typeof ASSISTANT_TOOLS = ASSISTANT_TOOLS,
  ): Promise<{ reply: string; toolCalls: AssistantToolCall[] }> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content ?? "";
    const toolCalls: AssistantToolCall[] = [];

    const run = async (name: string, args: unknown) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) return { error: `Unknown tool "${name}".` };
      const result = await tool.run(session, args);
      toolCalls.push({ name, args, result });
      return result;
    };

    if (/\bmy work\b|\bmy queue\b|\bassigned to me\b/i.test(text)) {
      const work = (await run("get_my_work", {})) as { items?: unknown[] } | { error: string };
      if ("error" in work) {
        return { reply: `I couldn't load your work queue: ${work.error}`, toolCalls };
      }
      const count = work.items?.length ?? 0;
      return {
        reply:
          count === 0
            ? "You have nothing outstanding right now."
            : `You have ${count} item${count === 1 ? "" : "s"} needing your action. Open My Work for the full list.`,
        toolCalls,
      };
    }

    const numberMatch = text.match(NUMBER_PATTERN)?.[0] ?? text.match(REGISTRATION_PATTERN)?.[0];
    if (numberMatch) {
      const results = (await run("search_records", { query: numberMatch })) as
        | Array<{ type: string; id: string; label: string }>
        | { error: string };
      if ("error" in results) {
        return { reply: `I couldn't search for "${numberMatch}": ${results.error}`, toolCalls };
      }
      if (results.length === 0) {
        return { reply: `I couldn't find anything matching "${numberMatch}".`, toolCalls };
      }
      const match = results[0];
      const detailToolName =
        match.type === "incident" ? "get_incident" : match.type === "claim" ? "get_claim" : "get_vehicle";
      const idField =
        match.type === "incident" ? "incidentId" : match.type === "claim" ? "claimId" : "vehicleId";
      await run(detailToolName, { [idField]: match.id });
      return {
        reply: `Found ${match.label} (${match.type}). See the full record in the app for details — this is the stub assistant (ASSISTANT_PROVIDER unset/"stub"), which doesn't summarize freely.`,
        toolCalls,
      };
    }

    return {
      reply:
        "I'm the stub Mitra assistant — I can look up an incident/claim number or vehicle registration, or tell you what's on your My Work queue. Try asking about one of those, or configure ASSISTANT_PROVIDER=claude for free-form Q&A.",
      toolCalls,
    };
  }
}
