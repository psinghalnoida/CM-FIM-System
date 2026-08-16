// Plain unit test — the real Anthropic client is mocked (no network
// call, no ANTHROPIC_API_KEY needed beyond a fake one set for the test).
// Exercises the manual tool-use loop, refusal handling, and the
// iteration cap without ever hitting the real API — this sandbox has no
// ANTHROPIC_API_KEY, so this is the only verification available here;
// live verification needs a real key (same caveat as OCR's Textract
// adapter). See lib/assistant/claude-provider.ts's own header comment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "@/lib/dal";
import type { AssistantTool } from "@/lib/assistant/tools";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(function MockAnthropic(this: {
      messages: { create: typeof createMock };
    }) {
      this.messages = { create: createMock };
    }),
  };
});

const fakeSession = { user: { id: "u1", organizationId: "org1" } } as unknown as AuthSession;

function textResponse(text: string) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

function toolUseResponse(name: string, input: unknown, id = "toolu_1") {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
  };
}

describe("ClaudeAssistantProvider (M30)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalModel = process.env.ASSISTANT_MODEL;

  beforeEach(() => {
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    delete process.env.ASSISTANT_MODEL;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.ASSISTANT_MODEL;
    else process.env.ASSISTANT_MODEL = originalModel;
  });

  it("throws at construction when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { ClaudeAssistantProvider } = await import("@/lib/assistant/claude-provider");
    expect(() => new ClaudeAssistantProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("runs the requested tool with the caller's session, then returns the model's follow-up text", async () => {
    const run = vi.fn().mockResolvedValue({ id: "inc-1", incidentNumber: "INC-2026-000001" });
    const tools: AssistantTool[] = [
      { name: "get_incident", description: "...", input_schema: { type: "object" }, run },
    ];
    createMock
      .mockResolvedValueOnce(toolUseResponse("get_incident", { incidentId: "inc-1" }))
      .mockResolvedValueOnce(textResponse("INC-2026-000001 is open."));

    const { ClaudeAssistantProvider } = await import("@/lib/assistant/claude-provider");
    const provider = new ClaudeAssistantProvider();
    const { reply, toolCalls } = await provider.chat(
      fakeSession,
      [{ role: "user", content: "What's the status of INC-2026-000001?" }],
      tools,
    );

    expect(run).toHaveBeenCalledWith(fakeSession, { incidentId: "inc-1" });
    expect(toolCalls).toEqual([
      { name: "get_incident", args: { incidentId: "inc-1" }, result: { id: "inc-1", incidentNumber: "INC-2026-000001" } },
    ]);
    expect(reply).toBe("INC-2026-000001 is open.");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("returns a plain reply, no tool calls, when the model never asks for a tool", async () => {
    createMock.mockResolvedValueOnce(textResponse("Hi, how can I help?"));
    const { ClaudeAssistantProvider } = await import("@/lib/assistant/claude-provider");
    const provider = new ClaudeAssistantProvider();
    const { reply, toolCalls } = await provider.chat(fakeSession, [{ role: "user", content: "hi" }], []);
    expect(reply).toBe("Hi, how can I help?");
    expect(toolCalls).toEqual([]);
  });

  it("handles a safety-classifier refusal without crashing or calling tools", async () => {
    createMock.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    const { ClaudeAssistantProvider } = await import("@/lib/assistant/claude-provider");
    const provider = new ClaudeAssistantProvider();
    const { reply, toolCalls } = await provider.chat(fakeSession, [{ role: "user", content: "..." }], []);
    expect(reply).toMatch(/can't help/i);
    expect(toolCalls).toEqual([]);
  });

  it("stops after the iteration cap instead of looping forever on a model that always calls tools", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    const tools: AssistantTool[] = [
      { name: "get_my_work", description: "...", input_schema: { type: "object" }, run },
    ];
    createMock.mockResolvedValue(toolUseResponse("get_my_work", {}));

    const { ClaudeAssistantProvider } = await import("@/lib/assistant/claude-provider");
    const provider = new ClaudeAssistantProvider();
    const { reply, toolCalls } = await provider.chat(fakeSession, [{ role: "user", content: "loop forever" }], tools);

    expect(reply).toMatch(/wasn't able to finish/i);
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(createMock.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
