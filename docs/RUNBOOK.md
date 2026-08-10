# Operations Runbook — M15

Status: documented. Common day-2 operational tasks — not a design doc
(see `docs/DEPLOYMENT.md` for that); this is "what do I actually run"
when something needs doing or something looks wrong.

## Seeding / migrations

```bash
npm run db:migrate:deploy   # apply pending migrations (CI/prod-safe — never generates a new one)
npm run db:seed             # realistic JBM demo dataset — see docs/DEPLOYMENT.md's warning about NODE_ENV=production
npm run db:studio           # browse the database directly (Prisma Studio)
```

`db:seed` is idempotent — re-running it after the first time is a no-op
(everything's keyed off stable identifiers: org code, user email, depot
code, a fixed marker in each sample incident's description). Safe to run
again if you're not sure whether it already ran.

## Restarting the worker

The worker (`workers/index.ts`) processes OCR extraction jobs and runs
the 15-minute escalation scan. If documents are stuck in OCR `PENDING`
status, or escalations aren't firing, check the worker is actually
running before anything else:

```bash
npm run worker:start        # foreground, one-shot
npm run worker:dev          # foreground, auto-reload on file changes (dev only)
```

In Docker, this is the separate `worker` container/target — see
`docs/DEPLOYMENT.md`. A crashed worker doesn't show up as an app-level
error; symptoms are purely "nothing is happening" (stuck `PENDING` OCR
extractions, no new `EscalationEvent` rows past a stage's breach time).

## Triggering an escalation scan manually

The scheduled job fires every 15 minutes automatically, but you don't
have to wait for it:

```bash
curl -X POST http://localhost:3000/api/escalations/scan \
  -H "Cookie: cm_fim_session=<a real ORG_ADMIN session cookie>"
```

Scoped to the caller's own org (`ORG_ADMIN` only). Returns
`{ fired, skipped }` — `skipped` counts non-EMAIL-channel rules that
matched but couldn't actually be sent yet (see `docs/ESCALATIONS.md`);
it isn't an error.

## Checking BullMQ queue health

Three named queues, all on the same Redis instance (`REDIS_URL`):

| Queue | Purpose |
| --- | --- |
| `ocr-extraction` | Document upload → OCR extraction job (`lib/ocr/queue.ts`) |
| `escalation-scan` | The repeatable 15-minute scan (`workers/index.ts`) |
| `system-healthcheck` | One-shot job fired on worker boot, proves the worker can reach Redis |

Inspect from `redis-cli` directly (no separate dashboard is wired up):

```bash
redis-cli -u "$REDIS_URL" keys "bull:ocr-extraction:*"
redis-cli -u "$REDIS_URL" llen "bull:ocr-extraction:wait"     # jobs waiting
redis-cli -u "$REDIS_URL" llen "bull:ocr-extraction:failed"   # jobs that errored
```

A persistently non-zero `wait` count with the worker running usually
means the worker crashed mid-job and didn't recover — check its logs
first.

## Recovering from a dropped Postgres/Redis connection

Both are managed processes (`docker-compose.yml` service, or your real
infra's own restart policy) — the app and worker don't self-heal a
connection that was never established at boot. Restart the dependency,
then restart whichever of app/worker lost the connection:

```bash
# docker-compose:
docker compose restart postgres redis
docker compose restart app worker

# bare processes (e.g. this project's own dev sandbox):
service postgresql start
redis-server --daemonize yes --port 6379
```

## Re-running the audit trail for one entity

Every write in this system goes through `recordAudit()` (BR-08) — one
table, `audit_logs`, is the single source of truth for "what changed and
who did it":

```sql
SELECT action, actor_id, before_data, after_data, created_at
FROM audit_logs
WHERE entity_type = 'Claim' AND entity_id = '<uuid>'
ORDER BY created_at ASC;
```

## Checking the API surface

`docs/openapi.yaml` is the reference for every route this system
exposes — open it in any OpenAPI viewer (e.g.
[Redocly](https://redocly.com/docs/cli/commands/preview-docs), or
`npx @redocly/cli preview-docs docs/openapi.yaml`) for a browsable
version. Hand-maintained against the actual route handlers — if a route
changes, update the spec in the same change.

## Running the e2e smoke test

```bash
npm run build && npm run start &   # or npm run dev
npm run test:e2e                    # BASE_URL defaults to http://localhost:3000
```

Exercises the full incident → claim → settlement → payment → reconcile
→ close lifecycle over real HTTP against a running instance, including
BR-09's 409 rejections at every blocking stage and a cross-org RBAC
check. Mints and cleans up its own org/user/data on every run — safe
against a shared dev database, not just a throwaway one. See
`e2e/lifecycle.e2e.ts`'s own header comment for why this is a plain
script rather than a browser-automation framework.

## Sandbox-specific note (this development environment only)

Postgres and Redis in this particular sandbox are not always kept
running between sessions. If a command fails with "Can't reach database
server" or a Redis connection error, first try:

```bash
service postgresql start
redis-server --daemonize yes --port 6379
```

then re-run whatever failed. This has been the standard recovery step
throughout this project's development — see any of `docs/OCR.md`,
`docs/ESCALATIONS.md`, `docs/PAYMENTS.md` for it recurring.
