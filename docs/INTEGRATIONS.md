# Administration: Integration Settings — M29

Status: implemented (`lib/integrations/status.ts`,
`app/(app)/admin/integrations/page.tsx`, `app/api/health/route.ts`) ·
verified via a unit test and a real HTTP walkthrough against the built
app (see "Verification" below).

Covers: a status view of every external adapter this system integrates
with — the design's Administration > Integration Settings screen — plus
the `/api/health` endpoint `docs/DEPLOYMENT.md` had flagged as a real
gap, since both need the identical underlying "is this configured and
reachable" check.

**Update (M30):** the Mitra assistant (`ASSISTANT_PROVIDER`) is now a
third real check alongside OCR/Email — `lib/integrations/status.ts`
resolves it the same way, via `getAssistantProvider()` directly. See
`docs/MITRA.md`.

## Design decisions and why

**WhatsApp and Telematics report a static "Not built yet," not a fake
reachability check.** `docs/SCOPE.md`'s M29 row names WhatsApp/Telematics
alongside OCR/Email, but M10 (WhatsApp) and M12 (Telematics) were never
built — no `WhatsAppProvider`/`TelematicsProvider` implementation exists
anywhere in the repo, only the interface sketches in `docs/SCOPE.md`
itself. Fabricating a "configured" or "reachable" result for code that
doesn't exist would be worse than admitting it plainly. Confirmed with
the user before building (see the M28→M29 handoff): OCR/Email get a real
live check; WhatsApp/Telematics get an honest `NOT_BUILT` status with a
pointer at the milestone that will actually build them. This is the same
posture the Telematics *tab* has taken twice already (M21's Incident
Detail, M28's Vehicle Detail) — a placeholder, never invented data.

**The check reuses `getOcrProvider()`/`getEmailProvider()` directly,
never a second copy of the env-var logic.** `lib/integrations/status.ts`
calls the exact functions `lib/ocr/process-extraction.ts` and
`lib/escalations/scan.ts` call on the real code path — so "configured and
reachable" here means precisely "would the next real OCR extraction/
escalation email actually resolve a provider," not a parallel guess that
could drift from the real resolution logic. This also means the OCR
check legitimately fails `MISCONFIGURED` if S3 storage isn't configured,
not just `OCR_PROVIDER` — `getOcrProvider()` transitively imports
`lib/s3.ts`, whose client is a module-load-time singleton that throws
without `S3_*` set, and the stub OCR provider really does write its raw
response to S3. Honest coupling, not a bug.

**`GET /api/health` is deliberately unauthenticated.** `proxy.ts`'s
matcher only ever covered page routes, never `/api/*` — API routes gate
themselves via `verifySession()` inside each handler. This route skips
that call on purpose: a liveness/readiness probe from an orchestrator
has no session to send, and `docs/DEPLOYMENT.md` had already flagged that
an unauthenticated `GET /login` proves the process is up but not that
Postgres/Redis are reachable. `/api/health` checks both for real
(`SELECT 1`, `PING`) and folds in the same integration statuses the admin
page shows a human, so there is exactly one "is everything OK" check in
the codebase, read by two different audiences.

**No new schema.** Every check here reads live env/module state (DB
query, Redis ping, provider resolution) — nothing about "integration
status" is a fact worth persisting.

## Verification

- **`lib/integrations/status.test.ts`** (3 tests, plain unit — no DB/S3
  fixtures needed beyond what the dev `.env` already provides): default
  `OCR_PROVIDER`/`EMAIL_PROVIDER` (unset → `stub`/`console`) both report
  `OK`; an unrecognized provider name for either fails closed as
  `MISCONFIGURED`; WhatsApp and Telematics always report `NOT_BUILT`.
- **Real HTTP, against the built app**: `GET /admin/integrations` as
  ORG_ADMIN — 200, all four rows render with the expected status/color;
  as a non-`ORG_ADMIN` role — the same "only ORG_ADMIN" gate every other
  Administration screen uses; unauthenticated — 307 to `/login` (covered
  by `proxy.ts`'s existing `/admin` prefix, no change needed there).
  `GET /api/health` unauthenticated — 200 with
  `"status": "ok"`/`checks.database.ok`/`checks.redis.ok` all true and
  `integrations` listing the same four statuses the admin page shows.

## Deferred to a follow-up

- **Real WhatsApp/Telematics status** — once M10/M12 actually ship an
  adapter, `lib/integrations/status.ts` gets two more real checks
  alongside OCR/Email; today there is nothing to check.
- **Worker queue depth in `/api/health`** — `docs/DEPLOYMENT.md` already
  called this out as a reasonable follow-up once there's an actual
  deployment target with queue-depth alerting to build it against, not
  invented speculatively here.
