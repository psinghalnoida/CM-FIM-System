# "Mitra" AI Assistant — M30

Status: implemented (`lib/assistant/*`, `app/api/mitra/chat/route.ts`,
`components/shell/mitra-widget.tsx`) · verified via unit/integration
tests and a real HTTP walkthrough against the built app (see
"Verification" below).

Covers: read-only Q&A over live fleet/incident/claim data via a chat
widget, per `docs/SCOPE.md`'s M30 description — an `AssistantProvider`
adapter (same pattern as `OCRProvider`/`EmailProvider`), a small fixed
set of read-only tool functions wrapping existing service-layer queries
with the asking user's real `AuthSession`, and client-side/ephemeral
conversation history for v1.

## Design decisions and why

**Confirmed with the user before building** (three open questions, all
flagged directly by gaps in `docs/SCOPE.md`'s own M30 description):

1. **Tool surface — "Core 5": `search_records`, `get_incident`,
   `get_claim`, `get_vehicle`, `get_my_work`.** Covers the two questions
   a chat assistant over this data is actually good for — "what's the
   status of X" and "what's on my plate" — without building a tool for
   every dashboard/report/master-data query nobody asked for yet.
2. **The chat widget itself had to be built from scratch.** SCOPE.md
   says Mitra lives "via the chat widget in M16's shell," but M16 never
   actually built one — only static Notifications/Help icon
   placeholders exist (see `docs/UI_FOUNDATION.md`'s own "Deferred to a
   follow-up" section). No design file exists for it either. Built as a
   floating widget on every protected page (`app/(app)/layout.tsx`),
   plain shadcn/ui styling — the same "no new visual system for one
   component" posture every other milestone in this UI-alignment batch
   has taken.
3. **The real `ClaudeAssistantProvider` is built now, not deferred.**
   Unlike OCR's Textract adapter (explicitly deferred pending AWS
   credentials), M30's own SCOPE.md description names `ASSISTANT_PROVIDER
   =claude` + `ANTHROPIC_API_KEY` as part of *this* milestone. Built with
   the official `@anthropic-ai/sdk` (never raw HTTP). This sandbox has no
   `ANTHROPIC_API_KEY`, so it can't be live-tested here — verified
   instead via `lib/assistant/claude-provider.test.ts` with the Anthropic
   client mocked (the tool-use loop, refusal handling, and iteration cap
   are all exercised without a real network call). Live verification
   needs a real key, the same caveat OCR's real adapter carries.

**No new access model.** Every tool in `lib/assistant/tools.ts` is a thin
wrapper calling an existing service-layer function
(`getIncident`/`getClaim`/`getVehicle`/`getMyWork`/`globalSearch`) with
the *caller's real session* — `scopedDb()`/RBAC/depot-scoping apply
exactly as everywhere else in this app. A tool never throws on a bad
argument, a not-found id, or a cross-org/cross-depot 403 — it returns a
plain `{ error: string }` result instead, so the model can explain the
problem to the user rather than the whole chat request failing on one
bad tool call. Verified explicitly (`tools.integration.test.ts`'s
cross-org isolation test), not assumed from `scopedDb()` existing.

**Manual tool-use loop, not the SDK's beta Tool Runner.** The tool set is
small, fixed, and each tool already bundles its own `run()` function
(`lib/assistant/tools.ts`'s `AssistantTool` shape) — hand-rolling the
request → `tool_use` → `tool_result` → repeat cycle in
`lib/assistant/claude-provider.ts` is a handful of lines and avoids
taking on a beta SDK dependency for something this scoped. A hard
6-iteration cap prevents a model that keeps calling tools from looping
forever.

**Model defaults to `claude-opus-5`, overridable via `ASSISTANT_MODEL`.**
This codebase's convention when using the Claude API is to default to
the latest/most-capable model unless told otherwise; JBM may prefer a
cheaper/faster model for a simple internal Q&A widget once this is live
— that's a config change (`ASSISTANT_MODEL`), not a code change.
`output_config.effort: "low"` is set explicitly: this is small-tool
structured lookups, not open-ended reasoning, so the cheaper/faster end
of the range fits; raise it if real-traffic answer quality says
otherwise.

**Conversation history is client-side/ephemeral, per SCOPE.md's own
scope.** `components/shell/mitra-widget.tsx` keeps messages in component
state only — gone on refresh, never persisted server-side, never sent
anywhere but the one `/api/mitra/chat` request.

**Usage logging and rate-limiting are deliberately not built.**
SCOPE.md's own M30 description leaves these as open questions rather
than something to build speculatively — unchanged here.

## Verification

- **`lib/assistant/tools.integration.test.ts`** (5 tests, real Postgres):
  `search_records` finds a seeded incident/claim/vehicle by number/
  registration; `get_incident`/`get_claim`/`get_vehicle` return the real
  record for a valid id; `get_incident` returns a plain `{ error }` —
  never throws — for a nonexistent id, a cross-org id, and malformed
  args; `get_my_work` runs for the caller's own session.
- **`lib/assistant/stub-provider.integration.test.ts`** (3 tests, real
  Postgres): "what's on my work queue" routes to `get_my_work`; a real
  incident number routes to `search_records` then `get_incident`;
  unrecognized text falls back to the generic help message with no tool
  calls.
- **`lib/assistant/claude-provider.test.ts`** (5 tests, plain unit — the
  Anthropic client mocked, no network call): throws at construction with
  no `ANTHROPIC_API_KEY`; runs the requested tool with the caller's real
  session and returns the model's follow-up text; returns a plain reply
  when the model never asks for a tool; handles a `stop_reason: "refusal"`
  without crashing; stops after the iteration cap instead of looping
  forever.
- **`lib/integrations/status.test.ts`** — extended to cover the Mitra
  assistant entry (OK for default stub, MISCONFIGURED for an unknown
  `ASSISTANT_PROVIDER` value or `claude` with no `ANTHROPIC_API_KEY`).
- **Real HTTP, against the built app**: unauthenticated `POST
  /api/mitra/chat` — 401; an empty `messages` array — 400; the default
  stub provider answering "what's on my work queue" (real `get_my_work`
  tool call, real counts) and a real seeded incident number (real
  `search_records` → `get_incident` chain, correct record returned);
  unrecognized text falls back to the generic help message; the Mitra
  widget button renders on a protected page; `ASSISTANT_PROVIDER=claude`
  with no `ANTHROPIC_API_KEY` fails closed (500 to the client, the real
  "ANTHROPIC_API_KEY is not set" error in server logs); an unknown
  `ASSISTANT_PROVIDER` value fails closed the same way.

## Deferred to a follow-up

- **Usage logging and rate-limiting** — deliberately left open per
  SCOPE.md's own M30 description, not built speculatively.
- **A broader tool surface** (dashboards, reports, master data) — the
  "Core 5" set covers status-lookup and my-queue questions; expand if
  real usage shows a specific gap.
- **Live verification of `ClaudeAssistantProvider`** — needs a real
  `ANTHROPIC_API_KEY` in an environment that has one; this sandbox
  doesn't.
