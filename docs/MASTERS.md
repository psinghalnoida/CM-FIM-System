# Vehicle/Depot/Driver Master Data — M4

Status: implemented (`lib/masters/*.ts`, `app/api/{cities,depots,vehicles,drivers}/`,
simple list pages) · verified via integration tests and real HTTP against
the built app (see "Verification" below).

Covers: City, Depot, Vehicle, and Driver CRUD (create/read/update, plus
archive for Vehicle/Driver) with RBAC, depot-scoping, and audit logging.
Full create/edit UI and bulk CSV import are explicitly deferred — see
"Deferred to a follow-up" below.

## Who can do what

| Action | ORG_ADMIN | DEPOT_MANAGER | Everyone else (authenticated) |
|---|---|---|---|
| Read cities | ✅ | ✅ | ✅ |
| Create/edit cities | ✅ | ❌ | ❌ |
| Read depots | ✅ (all) | ✅ (own depot only) | ✅ (all) |
| Create/edit depots | ✅ | ❌ | ❌ |
| Read vehicles/drivers | ✅ (all) | ✅ (own depot only) | ✅ (all) |
| Create/edit vehicles/drivers | ✅ (any depot) | ✅ (own depot only) | ❌ |
| Transfer a vehicle/driver to a different depot | ✅ | ❌ | ❌ |
| Archive (soft-delete) a vehicle/driver | ✅ | ✅ (own depot only) | ❌ |

Roles other than ORG_ADMIN/DEPOT_MANAGER (CLAIMS_MANAGER, SURVEYOR,
WORKSHOP_COORDINATOR, FINANCE_OFFICER, AUDITOR) get full org-wide **read**
access to all four — they need cross-depot visibility for their own jobs
(e.g. a claims manager handling a claim from any depot) — but no write
access to master data itself.

## Design decisions and why

**DEPOT_MANAGER is scoped to their own depot for both reads and writes —
`lib/masters/depot-scope.ts`.** This sits on top of org-scoping
(`lib/scoped-db.ts`), one level narrower, applied only to this one role.
Every other role gets full org-wide reads. This was an explicit product
decision (not the schema/RBAC-table default) — see the chat record for the
alternative considered (read-only cross-depot visibility) and why it was
rejected: a depot manager's job is scoped to their depot, and giving wider
read access "just in case" adds a real information-exposure question
(can they see another depot's vehicle utilization? driver roster?) with no
stated need behind it yet.

**City and Depot records themselves are ORG_ADMIN-only; DEPOT_MANAGER
manages Vehicle/Driver within their depot but not the Depot record
itself.** Creating/renaming a depot is an org-structure change, distinct
from day-to-day fleet management. A DEPOT_MANAGER with no depot assigned
(a data-integrity gap) gets `forbidden()` rather than silently seeing
nothing — `depotScopeFor()` throws in that case instead of returning an
empty scope that would look like "correctly scoped to zero results."

**Moving a vehicle/driver to a different depot requires ORG_ADMIN, even
for a DEPOT_MANAGER editing a record that's currently in their own
depot.** `updateVehicle`/`updateDriver` check `assertDepotInScope` against
the *existing* record first (so a DEPOT_MANAGER can't touch a vehicle
outside their depot at all), then separately require ORG_ADMIN if the
update actually changes `depotId`. A depot manager can freely edit every
other field of their own vehicles, but reassigning an asset in/out of
their depot is treated as an org-structure decision, not routine fleet
management — same reasoning as Depot ownership above.

**Vehicle/Driver are soft-deleted (`status: INACTIVE`), never hard-deleted.**
Both are referenced by other tables (`Incident.vehicleId`/`driverId`, and
more from M6/M7 onward); a hard delete would either cascade-destroy
historical incident data or be blocked by the FK, neither of which is the
right UX for "this vehicle left the fleet." `archiveVehicle`/
`archiveDriver` are the only write path that changes `status`, and they
record a `STATUS_CHANGE` audit entry (distinct from `UPDATE`).

**Every write path calls `recordAudit()` (BR-08), reusing the single write
path established in M3.** No `lib/masters/*.ts` function writes to
`AuditLog` directly — they all go through `lib/audit.ts`.

**Registration numbers and license numbers are upper-cased on input.** A
`.transform()` in the Zod schema, not a DB trigger — normalizes "hr55ab1234"
and "HR55AB1234" to the same stored value so the DB's uniqueness
constraint (`organizationId` + `registrationNumber`/`licenseNumber`)
actually catches duplicates entered with different casing, without
imposing a strict format regex real-world plates/licenses might not match.

**API routes are a thin layer over the service functions — validation and
business rules live in `lib/masters/*.ts`, not in `app/api/**/route.ts`.**
Every route follows the same shape: `verifySession()`, call the service
function, map errors via `lib/api-errors.ts`'s `toApiErrorResponse()`
(Zod → 400, Prisma unique-constraint `P2002` → 409, not-found `P2025` →
404, everything else → 500 — while re-throwing Next's own
`unauthorized()`/`forbidden()`/`redirect()` control-flow errors via
`unstable_rethrow` so they aren't swallowed as generic 500s). This is the
"protected API route pattern" M3 set out to establish, now used by four
real resources instead of just the one reference route (`/api/me`).

## Deferred to a follow-up

- **Full create/edit UI.** M4 ships one list page per entity
  (`app/{cities,depots,vehicles,drivers}/page.tsx`) proving the service/API
  layer end-to-end, not create/edit forms. Building those against an API
  contract that's actually been exercised (this milestone) rather than
  guessed at was the explicit trade-off — see the chat record.
- **Bulk CSV import.** A distinct feature (file upload, per-row validation,
  partial-failure UX) with real design questions of its own — cleaner as
  its own milestone once single-record CRUD exists to validate rows
  against.
- **Organization CRUD.** JBM's `Organization` row is seeded once
  (`prisma/seed.ts`); Phase 1 is single-org, so there's no "manage
  organizations" screen — revisit alongside real multi-tenant deployment.

## Verification

- **`lib/masters/masters.integration.test.ts`** (real Postgres, 15 tests):
  ORG_ADMIN-only City/Depot writes; any role can read cities;
  DEPOT_MANAGER confined to their own depot on both create and list, for
  both Vehicle and Driver; cross-depot transfer rejected for
  DEPOT_MANAGER and allowed for ORG_ADMIN; `archiveVehicle` sets
  `INACTIVE` and records a `STATUS_CHANGE` audit entry; CREATE/UPDATE
  audit entries recorded for City; registration-number normalization;
  Zod validation rejects an empty city name; a role with no write access
  (CLAIMS_MANAGER) is rejected creating a driver.
- **Real HTTP, against the built app**: unauthenticated `GET /api/vehicles`
  → `401`; authenticated create/list/duplicate/archive round-trip for
  Vehicle and City (`POST` → `201`, duplicate registration → `409`,
  missing required field → `400` with field-level Zod detail, `DELETE` →
  `200` with `status: "INACTIVE"`); `GET /vehicles` page renders the
  created vehicle; a DEPOT_MANAGER session attempting `POST /api/depots`
  → `403`.
