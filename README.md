# CM FIM System

Fleet Incident & Insurance Claim Management System — initially configured for JBM.

Manages the complete lifecycle of fleet incidents and insurance claims: a
single incident record tracked through documents, evidence, telematics
snapshots, survey activity, repair activity, TATs, escalations, settlement
and payment.

## Status

**M1–M9, M11, M13–M18** are done: app scaffold, Docker Compose, tooling,
the full Phase 1 Prisma schema, credential login/logout with
database-backed sessions, role gating and org-scoping,
City/Depot/Vehicle/Driver CRUD with depot-scoped RBAC and audit logging, a
document repository (presigned-URL upload, versioning, linked to
vehicles/drivers), incident creation/editing with an OPEN/CLOSED state
machine, `INC-YYYY-######` IDs and photo/video/document evidence
attachment, the claim workflow (incident→claim conversion, BR-05 policy
auto-selection, the `ClaimStatus` state machine (`CLM-YYYY-######`),
surveys, and workshop/repair job tracking), a TAT engine (configurable
per-org/case-type stage templates, sequential auto-instantiated stage
tracking with on-hold periods, and elapsed-time calculation excluding
held time), an operational dashboard (org-wide or depot-filtered
incident/claim status counts, TAT breach counts, and aging, backed by
live queries — no mocks), OCR/document parsing (an `OCRProvider` adapter
with a real deterministic stub, an async BullMQ extraction job, and
human-verification that's the only path fields ever reach master data,
per BR-07), and notifications/escalations (a repeatable BullMQ reminder
scheduler, a configurable escalation hierarchy wired to TAT breaches, and
a real `EmailProvider` stub, per PR-03), and payment & closure
(settlement create/approve/reject, payment recording and reconciliation,
and BR-09's closure-blocking rule — no claim reaches `CLOSED` until every
non-rejected settlement on it is approved, fully paid, and reconciled),
and testing/deployment hardening (a realistic multi-depot JBM demo seed
dataset, a full green test suite — 149 unit/integration tests plus a
real-HTTP e2e smoke script, a hand-maintained OpenAPI spec for the whole
API surface, and deployment/runbook docs), a UI foundation (a shared
nav shell — sidebar + header — every page now renders inside, and the
Claims Mitra design's color/type/spacing tokens adopted app-wide), and
global search (incident/claim/vehicle number, wired into the header),
and Administration: Users (create/list/deactivate + role assignment —
the first real way to manage a user other than direct database access).
M19-M30, the rest of the UI-alignment milestones scoped from that
design, remain — see `docs/SCOPE.md`'s "UI/UX alignment" section. M10 (WhatsApp)
and M12 (Telematics) are deferred pending JBM credentials; the roadmap
otherwise continues with whatever's scoped next. See
[`docs/SCOPE.md`](docs/SCOPE.md) for the milestone plan,
[`docs/schema/`](docs/schema/), [`docs/AUTH.md`](docs/AUTH.md),
[`docs/MASTERS.md`](docs/MASTERS.md),
[`docs/DOCUMENTS.md`](docs/DOCUMENTS.md),
[`docs/INCIDENTS.md`](docs/INCIDENTS.md),
[`docs/CLAIMS.md`](docs/CLAIMS.md), [`docs/TAT.md`](docs/TAT.md),
[`docs/DASHBOARDS.md`](docs/DASHBOARDS.md), [`docs/OCR.md`](docs/OCR.md),
[`docs/ESCALATIONS.md`](docs/ESCALATIONS.md),
[`docs/PAYMENTS.md`](docs/PAYMENTS.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md),
[`docs/RUNBOOK.md`](docs/RUNBOOK.md), [`docs/openapi.yaml`](docs/openapi.yaml),
and [`docs/UI_FOUNDATION.md`](docs/UI_FOUNDATION.md) for what's
implemented so far, and [`docs/RULES.md`](docs/RULES.md) for the
Business Rules / Process Rules the system is being built against.

Try it locally: seed the dev database (`npm run db:seed`) and sign in at
`/login` with `admin@jbm.example` / `ChangeMe123!` (dev-only credentials,
never valid in production).

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui · PostgreSQL +
Prisma (via the `pg` driver adapter, no engine binary) · Redis + BullMQ ·
S3-compatible object storage (MinIO locally, AWS S3 in prod).

## Local development

Prereqs: Node 22+, npm, and Docker (for Postgres/Redis/MinIO).

```bash
cp .env.example .env

# Start infra only (Postgres, Redis, MinIO) — the app itself runs on the
# host via `npm run dev` for a fast feedback loop:
docker compose up postgres redis minio minio-init -d

npm install
npm run db:migrate     # apply migrations (creates the schema)
npm run db:seed         # realistic JBM demo dataset (masters, users per role, sample claims)
npm run dev              # Next.js app on http://localhost:3000
npm run worker:dev        # BullMQ worker process, in a second terminal
```

To run the whole stack (including the app and worker) in containers
instead:

```bash
docker compose up --build
```

### Common scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run worker:dev` | BullMQ worker, with auto-reload |
| `npm run build` / `npm run start` | Production build / run |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run test` / `npm run test:watch` | Vitest |
| `npm run db:generate` | Regenerate the Prisma client after a schema change |
| `npm run db:migrate` | Create/apply a dev migration |
| `npm run db:migrate:deploy` | Apply migrations without generating a new one (CI/prod) |
| `npm run db:studio` | Prisma Studio (DB browser) |
| `npm run db:seed` | Seed a dev-only, realistic JBM demo dataset (masters data, one user per role, sample claims across the lifecycle) |
| `npm run test:e2e` | Real-HTTP e2e smoke test against a running build (see `docs/RUNBOOK.md`) |

Document-repository, evidence, and OCR tests (`lib/documents/*.test.ts`,
`lib/incidents/evidence.integration.test.ts`, `lib/ocr/*.test.ts`) each
start their own in-process S3-compatible test server
([s3rver](https://github.com/jamhall/s3rver)) in `beforeAll`, on
different ports (4569 / 4570 / 4571) so they can run concurrently — no
MinIO/Docker needed to run them, but they do need
`S3_ENDPOINT=http://localhost:4569`, `S3_REGION=us-east-1`,
`S3_ACCESS_KEY_ID=S3RVER`, `S3_SECRET_ACCESS_KEY=S3RVER`,
`S3_BUCKET=cm-fim-documents-test`, `S3_FORCE_PATH_STYLE=true` set
alongside `DATABASE_URL`/`SESSION_SECRET` when running `npm run test`
(the evidence/OCR suites override these to their own ports internally).
Since M11, `REDIS_URL=redis://localhost:6379` (a real Redis — no
Docker/MinIO needed, `redis-server` runs standalone) is also required for
the full suite: completing a document upload now enqueues a real BullMQ
job (`lib/ocr/queue.ts`), so document/evidence tests need Redis reachable
too, not just OCR's own tests.

## Docs

- [`docs/SCOPE.md`](docs/SCOPE.md) — milestone-by-milestone delivery plan, domain model, module boundaries, adapter contracts.
- [`docs/RULES.md`](docs/RULES.md) — Business Rules and Process Rules, each with a reason, kept current as modules are scoped.
- [`docs/schema/`](docs/schema/) — per-milestone database schema documentation (ER diagrams, design rationale).
- [`docs/AUTH.md`](docs/AUTH.md) — auth/session/RBAC/org-scoping design and how it was verified.
- [`docs/MASTERS.md`](docs/MASTERS.md) — vehicle/depot/driver master data: who can do what, and why.
- [`docs/DOCUMENTS.md`](docs/DOCUMENTS.md) — document repository: the presigned-upload flow and how it was verified.
- [`docs/INCIDENTS.md`](docs/INCIDENTS.md) — incident workflow, evidence attachment, and two real bugs found and fixed while building it.
- [`docs/CLAIMS.md`](docs/CLAIMS.md) — claim workflow, BR-05 policy auto-selection, surveys, workshop/repair jobs, and how it was verified.
- [`docs/TAT.md`](docs/TAT.md) — the TAT engine: configurable stage templates, sequential auto-instantiation, on-hold periods, and elapsed-time calculation excluding holds.
- [`docs/DASHBOARDS.md`](docs/DASHBOARDS.md) — the operational dashboard: status counts, TAT breach counts, aging, and how it was verified.
- [`docs/OCR.md`](docs/OCR.md) — OCR/document parsing: the provider adapter, async extraction, human-verification, and a real `server-only`-vs-worker bug found and fixed while building it.
- [`docs/ESCALATIONS.md`](docs/ESCALATIONS.md) — notifications/escalations: the reminder scheduler, escalation hierarchy, the `EscalationEvent` schema addition, and how it was verified with a real worker process.
- [`docs/PAYMENTS.md`](docs/PAYMENTS.md) — payment & closure: settlement/payment recording, reconciliation, BR-09's closure gate, a real cross-org bug found and fixed while building it, and how it was verified over real HTTP.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploying beyond local docker-compose: the two runtime images, full env-var reference, migrations, health checks, scaling notes.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — common day-2 ops tasks: seeding, restarting the worker, triggering an escalation scan, checking queue health, the audit trail, running the e2e smoke test.
- [`docs/openapi.yaml`](docs/openapi.yaml) — OpenAPI 3.0 spec for the full `/api` surface, hand-maintained against the real route handlers.
- [`docs/UI_FOUNDATION.md`](docs/UI_FOUNDATION.md) — the nav shell (sidebar + header), route-group restructuring, and the Claims Mitra design's tokens adopted app-wide.
- [`docs/SEARCH.md`](docs/SEARCH.md) — global search: scope, the exact RBAC/depot-scoping reuse, and how it was verified.
- [`docs/ADMIN_USERS.md`](docs/ADMIN_USERS.md) — user management: RBAC, password handling, the self-deactivation lock, and how session invalidation was verified live.
