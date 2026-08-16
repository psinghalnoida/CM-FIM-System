"use client";

import { useRef, useState } from "react";
import { Bot, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// M30: Mitra — a floating chat widget on every protected page, per the
// design's "chat widget in M16's shell" reference. No design file exists
// for this widget specifically (M16 never actually built one — only
// static Notifications/Help icon placeholders), so placement/structure
// were confirmed with the user before building, same posture as M28's
// tab-structure question. Plain shadcn/ui styling, matching every other
// page — no new visual system introduced for this one component.
//
// Conversation history is client-side/ephemeral for v1 (per
// docs/SCOPE.md's own M30 scope) — it lives in this component's state
// and is gone on refresh, never persisted server-side.
export function MitraWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/mitra/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        throw new Error(`Mitra couldn't respond (${res.status}).`);
      }
      const data = (await res.json()) as { reply: string };
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Mitra assistant"
        className="bg-primary text-primary-foreground fixed right-6 bottom-6 z-50 flex size-12 items-center justify-center rounded-full shadow-lg"
      >
        <Bot className="size-5" />
      </button>
    );
  }

  return (
    <div className="bg-popover border-border fixed right-6 bottom-6 z-50 flex h-[480px] w-[360px] flex-col rounded-lg border shadow-xl">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4" />
          Mitra
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Mitra assistant"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Ask about an incident/claim number, a vehicle registration, or
            what&apos;s on your My Work queue.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-md px-3 py-2 text-sm ${
              m.role === "user"
                ? "bg-primary text-primary-foreground ml-8"
                : "bg-muted mr-8"
            }`}
          >
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="text-muted-foreground mr-8 text-sm">Thinking…</div>
        )}
        {error && <div className="text-status-red-fg text-sm">{error}</div>}
      </div>

      <div className="border-border flex items-center gap-2 border-t p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask Mitra…"
          className="border-input h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
        />
        <Button size="icon" onClick={() => void send()} disabled={sending}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
