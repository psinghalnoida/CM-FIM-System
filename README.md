# CM FIM System

Fleet Incident & Insurance Claim Management System — initially configured for JBM.

Manages the complete lifecycle of fleet incidents and insurance claims: a
single incident record tracked through documents, evidence, telematics
snapshots, survey activity, repair activity, TATs, escalations, settlement
and payment.

## Status

**M1 — Foundations.** App scaffold, Docker Compose, tooling. No domain
schema, auth, or business logic yet — see [`docs/SCOPE.md`](docs/SCOPE.md)
for the milestone plan and [`docs/RULES.md`](docs/RULES.md) for the
Business Rules / Process Rules the system is being built against.

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
npm run db:generate   # generate the Prisma client (no models yet — M2)
npm run dev            # Next.js app on http://localhost:3000
npm run worker:dev      # BullMQ worker process, in a second terminal
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
| `npm run db:studio` | Prisma Studio (DB browser) |

## Docs

- [`docs/SCOPE.md`](docs/SCOPE.md) — milestone-by-milestone delivery plan, domain model, module boundaries, adapter contracts.
- [`docs/RULES.md`](docs/RULES.md) — Business Rules and Process Rules, each with a reason, kept current as modules are scoped.
