# Deployment — M15

Status: documented. Covers running this system somewhere real (not just
`docker compose up` on a laptop, which the [README](../README.md)'s
"Local development" section already walks through) — the two runtime
images, the full environment-variable reference, migrations, and what a
health check can and can't rely on today.

## The two images

`Dockerfile` produces two separate runtime images from one build:

| Target   | Runs                              | Build            |
| -------- | ---------------------------------- | ---------------- |
| `web`    | the Next.js app (`server.js`, standalone output) | `docker build --target web -t cm-fim-web .` |
| `worker` | `workers/index.ts` via `tsx` (BullMQ job processor: OCR extraction, the 15-minute escalation scan) | `docker build --target worker -t cm-fim-worker .` |

Both need the same `DATABASE_URL`/`REDIS_URL`/`S3_*` values — the worker
talks to the same Postgres and Redis as the app, and touches S3 directly
for OCR extraction. **Run at least one of each.** The app enqueues jobs
(document uploads → OCR extraction) that only the worker processes;
without a worker running, uploaded documents sit in `PENDING` OCR status
forever and escalations never fire. The worker itself serves no HTTP
traffic and needs no exposed port.

`docker-compose.yml` wires up a complete local stack (Postgres, Redis,
MinIO, the app, and the worker) — see the README for that. This doc is
about the pieces docker-compose already assumes: what each container
actually needs to run correctly wherever it ends up (a real Postgres/S3,
Kubernetes, ECS, ...).

## Environment variables

The authoritative list — with comments explaining *why* each one exists
and which milestone introduced it — is `.env.example`. Summarized:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | always | Postgres connection string (`@prisma/adapter-pg` — no query-engine binary, talks to Postgres directly) |
| `SESSION_SECRET` | always | Signs the session cookie (HS256). Generate a real one per environment: `openssl rand -base64 32`. **Never reuse the `.env.example` value.** |
| `REDIS_URL` | always (app **and** worker) | BullMQ needs Redis reachable from both — completing a document upload enqueues a real job from the app process, not just the worker |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | always | Any S3-compatible store: MinIO locally, real AWS S3 in production |
| `S3_FORCE_PATH_STYLE` | prod: `false` | `true` for MinIO (bucket-in-path URLs); AWS S3 resolves virtual-hosted-style, so set `false` there |
| `DOCUMENT_MAX_FILE_SIZE_BYTES` | optional | Defaults to 100MB |
| `OCR_PROVIDER` | optional | Defaults to `stub` (deterministic, no external calls). Setting anything else today fails closed — no real Textract adapter exists yet (pending AWS credentials for JBM, see `docs/OCR.md`) |
| `EMAIL_PROVIDER` | optional | Defaults to `console` (logs, doesn't send). Same fail-closed behavior — no real SES/SendGrid adapter yet, see `docs/ESCALATIONS.md` |
| `PORT` | optional | Web container's listen port, defaults to 3000 |

**Never set `NODE_ENV=production` while running `npm run db:seed`** — the
seed script refuses outright (it plants fixed, publicly-known dev
passwords across every seeded role). Seed a real production org through
the app's normal signup/admin-provisioning path once one exists, not this
script.

## Migrations

- **Dev**: `npm run db:migrate` (creates a new migration from schema
  changes, applies it, regenerates the Prisma client).
- **Deploy** (CI/CD, or manually against a real environment):
  `npm run db:migrate:deploy` — applies pending migrations only, doesn't
  generate a new one from uncommitted schema drift. This is what should
  run before rolling out a new `web`/`worker` image, not `db:migrate`.
- Migrations live in `prisma/migrations/` and are committed to the repo —
  there is no separate migration-runner container; run
  `db:migrate:deploy` as a one-off job (or an init container) ahead of
  the actual app/worker rollout, so a new image never starts against a
  schema it doesn't expect.

## Health checks

**There is no dedicated `/api/health` route today** — a real gap, not an
oversight to route around silently. Until one exists:

- **Web**: an unauthenticated `GET /login` returns `200` when the app is
  up and Next.js is serving requests. It does **not** prove the database
  is reachable — `verifySession()` (which does hit Postgres) only runs on
  protected routes. A liveness probe against `/login` catches "the
  process is up"; it won't catch "Postgres is down" until an actual
  request needing DB access fails.
- **Worker**: `workers/index.ts` enqueues a `system-healthcheck` job on
  boot and processes it immediately (see the file's own comment) — a
  successful boot log line is the closest thing to a liveness signal
  right now. There's no HTTP surface to probe; a container orchestrator
  would need to check the process is alive (PID-based), not an HTTP
  endpoint.
- **Postgres/Redis/MinIO**: `docker-compose.yml`'s own `healthcheck:`
  blocks (`pg_isready`, `redis-cli ping`, `mc ready`) are real and can be
  reused directly in a Kubernetes readiness probe or similar.

A real `/api/health` endpoint (DB + Redis reachability, worker queue
depth) is a reasonable follow-up once there's an actual deployment target
to build it against — not invented speculatively here.

## Scaling notes

- **Web**: stateless — sessions live in Postgres (`Session` table), not
  in-process, so multiple `web` replicas behind a load balancer work with
  no sticky-session requirement.
- **Worker**: BullMQ workers are safe to run multiple replicas of — jobs
  are claimed atomically from the Redis-backed queue, no coordination
  needed between worker instances. The repeatable escalation-scan job
  (`Queue.upsertJobScheduler()`, every 15 minutes) is deduplicated by
  BullMQ itself regardless of replica count.
- **Postgres**: the one genuinely stateful piece. `Session`, `AuditLog`,
  and every domain table live here — plan backups/HA around this, not
  around the app or worker containers.

## Verification

**Not verified against Docker in this milestone** — this sandbox has the
`docker` CLI but no reachable daemon, so `docker build`/`docker compose
up` couldn't actually be run here; this doc describes the Dockerfile/
docker-compose.yml as written (both predate M15, from M1), not a
freshly-confirmed build. What *has* been verified repeatedly throughout
this project, milestone after milestone, is the same app/worker code
running directly against real Postgres, Redis, and an S3-compatible
server (`s3rver`) — full `npm run build && npm run start` plus
`npm run worker:start`, with real HTTP walkthroughs exercising every
flow end-to-end; see `docs/PAYMENTS.md`, `docs/OCR.md`, and
`docs/ESCALATIONS.md` (the last of which specifically booted a real
worker process, not just called functions directly). The env-var
reference and migration/scaling notes above follow directly from reading
the actual `Dockerfile`/`docker-compose.yml` in this repo, cross-checked
against `.env.example` and every service module's real `process.env`
reads — not guessed at. If you deploy this for real, confirming the
Docker build itself (`docker build --target web .` /
`docker build --target worker .`) somewhere Docker is actually available
is the one remaining check this doc can't self-certify.
