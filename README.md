# CM FIM System

Fleet Incident & Insurance Claim Management System — initially configured for JBM.

Manages the complete lifecycle of fleet incidents and insurance claims: a
single incident record tracked through documents, evidence, telematics
snapshots, survey activity, repair activity, TATs, escalations, settlement
and payment.

## Status

**M1–M5** are done: app scaffold, Docker Compose, tooling, the full Phase 1
Prisma schema, credential login/logout with database-backed sessions, role
gating and org-scoping, City/Depot/Vehicle/Driver CRUD with depot-scoped
RBAC and audit logging, and a document repository (presigned-URL upload to
S3-compatible storage, versioning, linked to vehicles/drivers). Incidents,
claims, and the rest of the business workflow start at M6+. See
[`docs/SCOPE.md`](docs/SCOPE.md) for the milestone plan,
[`docs/schema/`](docs/schema/), [`docs/AUTH.md`](docs/AUTH.md),
[`docs/MASTERS.md`](docs/MASTERS.md), and
[`docs/DOCUMENTS.md`](docs/DOCUMENTS.md) for what's implemented so far,
and [`docs/RULES.md`](docs/RULES.md) for the Business Rules / Process
Rules the system is being built against.

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
npm run db:seed         # creates a JBM org + an admin login for local testing
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
| `npm run db:seed` | Seed a dev-only JBM org + admin login |

Document-repository tests (`lib/documents/*.test.ts`) start their own
in-process S3-compatible test server ([s3rver](https://github.com/jamhall/s3rver))
in `beforeAll` — no MinIO/Docker needed to run them, but they do need
`S3_ENDPOINT=http://localhost:4569`, `S3_REGION=us-east-1`,
`S3_ACCESS_KEY_ID=S3RVER`, `S3_SECRET_ACCESS_KEY=S3RVER`,
`S3_BUCKET=cm-fim-documents-test`, `S3_FORCE_PATH_STYLE=true` set
alongside `DATABASE_URL`/`SESSION_SECRET` when running `npm run test`.

## Docs

- [`docs/SCOPE.md`](docs/SCOPE.md) — milestone-by-milestone delivery plan, domain model, module boundaries, adapter contracts.
- [`docs/RULES.md`](docs/RULES.md) — Business Rules and Process Rules, each with a reason, kept current as modules are scoped.
- [`docs/schema/`](docs/schema/) — per-milestone database schema documentation (ER diagrams, design rationale).
- [`docs/AUTH.md`](docs/AUTH.md) — auth/session/RBAC/org-scoping design and how it was verified.
- [`docs/MASTERS.md`](docs/MASTERS.md) — vehicle/depot/driver master data: who can do what, and why.
- [`docs/DOCUMENTS.md`](docs/DOCUMENTS.md) — document repository: the presigned-upload flow and how it was verified.
