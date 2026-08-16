# Vehicle/Depot/Driver Master Data — M4

Status: implemented (`lib/masters/*.ts`, `app/api/{cities,depots,vehicles,drivers}/`,
simple list pages) · verified via integration tests and real HTTP against
the built app (see "Verification" below).

Covers: City, Depot, Vehicle, and Driver CRUD (create/read/update, plus
archive for Vehicle/Driver) with RBAC, depot-scoping, and audit logging.
Full create/edit UI and bulk CSV import are explicitly deferred — see
"Deferred to a follow-up" below.

**Update (M27):** four more master-data entities — Insurer, Broker,
Surveyor, Workshop — landed under Administration &gt; Master Data,
turning what was free text on InsurancePolicy/Survey/RepairJob into
real, admin-managed rows. Real schema migration with a real backfill.
See "M27: Insurer/Broker/Surveyor/Workshop" below.

**Update (M28):** the first standalone Vehicle Detail page — an 8-tab
profile (Information/Status/Documents/Incidents/Claims/Repair History/
Warranty/Telematics) — plus a new `Warranty` model. See "M28: Vehicle
Detail" below.

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

## M27: Insurer/Broker/Surveyor/Workshop master data

The design's Administration &gt; Master Data screen asked for four
managed entities. Three of them (Insurer, Surveyor, Workshop) replace
free text that already existed on `InsurancePolicy`/`Survey`/`RepairJob`
— a real schema migration, not just new tables, since existing rows
already had real values in those free-text columns. Broker is new —
nothing referenced a broker before this milestone.

### The backfill plan

This is the actual point of the milestone, so it gets spelled out here
rather than just "there was a migration":

1. **Create the four master tables** (`insurers`, `brokers`,
   `surveyors`, `workshops`), each `@@unique([organizationId, name])`,
   matching every other master-data table's shape in this schema.
2. **Add the new FK columns nullable** (`InsurancePolicy.insurerId`/
   `brokerId`, `Survey.surveyorId`, `RepairJob.workshopId`) — the old
   free-text columns (`insurerName`, `surveyorName`/`surveyorContact`/
   `surveyorUserId`, `workshopName`/`workshopContact`/`workshopAddress`)
   stay in place at this point; step 3 still needs to read them.
3. **Backfill**: one master row per distinct `(organizationId, name)`
   pair found in the existing free-text data (`INSERT ... SELECT
   DISTINCT ...`), then `UPDATE` every existing row to point its new FK
   column at the matching master row. Where the same name appeared on
   multiple rows with different contact/address/linked-user values
   (Survey/RepairJob only — InsurancePolicy's old `insurerName` had no
   sibling fields), the first non-null value found wins
   (`DISTINCT ON (...) ORDER BY ..., (contact IS NULL), (linkedUserId
   IS NULL)`) — a real, documented limitation of collapsing free text
   into one row, not silently assumed perfect. **Distinct spellings or
   casing of the same real-world entity are not reconciled** (e.g.
   "ICICI Lombard" vs "Icici Lombard" would become two separate
   `Insurer` rows) — an automated backfill can't know they're the same
   business; a human merges real near-duplicates by hand afterward via
   the new Master Data admin UI (there's no merge tool — for the
   trivial-sized dataset this migration ran against, edit-and-delete
   through the UI is enough; revisit only if a real deployment turns up
   enough duplicates to make that tedious).
4. **Tighten to NOT NULL** on `insurerId`/`surveyorId`/`workshopId` (now
   safe — step 3 guarantees every row has one) — `brokerId` stays
   nullable, since it's genuinely optional (not every policy has a
   broker).
5. **Drop the old free-text columns.** Hard cutover, not a soft
   transition with both columns coexisting — every future write goes
   through master data. This was a deliberate choice given this system
   has no live production data yet (a pre-launch system, not a running
   one) — a real deployment with concurrent traffic would need this
   split across an expand/backfill/contract deploy sequence instead of
   one migration.

All five steps run inside a single hand-written migration file
(`prisma/migrations/20260811105203_m27_master_data/`), not generated by
`prisma migrate diff` — a raw schema diff has no way to express "add
this column nullable, backfill it, *then* make it required," it would
just emit an invalid `ADD COLUMN ... NOT NULL` against a table that
already has rows. The four `CREATE TABLE`/`ADD COLUMN`/backfill/`SET NOT
NULL`/`DROP COLUMN` steps are ordered so each later statement can still
see the data the previous one needs (e.g. the backfill `UPDATE` runs
before `insurerName` is dropped).

### Design decisions

**Contact/address info moved from the join records to the master
records.** `Survey.surveyorContact` and `RepairJob.workshopContact`/
`workshopAddress` used to be re-entered (or silently duplicated) on
every survey/repair job for the same real-world surveyor/workshop; now
they're a property of the `Surveyor`/`Workshop` row itself, set once.
`Surveyor.linkedUserId` (was `Survey.surveyorUserId`) moved for the same
reason — "is this surveyor an internal user" is a fact about the
surveyor, not about one particular survey.

**Broker is optional; Insurer/Surveyor/Workshop are required.** Every
policy needs an insurer, every survey needs a surveyor, every repair job
needs a workshop — but not every policy goes through a broker.
`InsurancePolicy.brokerId` is the one nullable FK among the four.

**No merge/dedupe tool, no soft-delete.** Same minimalism as
Depot/City's own master-data pattern (`lib/masters/depot.ts`,
`city.ts`) — create/read/update only, no delete endpoint, since these
rows are referenced by FK from real records and deleting one would
either need a real reassignment flow or cascade in a way nobody's asked
for yet.

**The create-form UI doesn't expose `Surveyor.linkedUserId`.** The
service (`lib/masters/surveyor.ts`) validates and stores it — it's a
real, tested field — but the Administration &gt; Master Data page's
create form only takes name/contact. Wiring a dropdown of internal
users into the generic `CreateMasterDataForm` for one uncommon field
across one of four entities was judged not worth the added complexity
for v1; still settable directly via `POST /api/admin/surveyors`.

**Survey/RepairJob creation forms became dropdowns, not free text.**
`components/claims/create-survey-form.tsx`/`create-repair-job-form.tsx`
now select from the org's `Surveyor`/`Workshop` rows instead of typing a
name — the whole point of the migration would be undone if the UI kept
accepting arbitrary text. An org with zero surveyors/workshops
configured yet (a fresh org before ORG_ADMIN has added any) shows an
explicit message pointing at Administration &gt; Master Data rather than
a broken or hidden form.

## M28: Vehicle Detail (tabbed profile) + Warranty

`app/(app)/vehicles/[id]/page.tsx` — the first standalone vehicle-detail
page (previously the only vehicle-specific page was the M5 documents
demo, folded into this page's Documents tab). Eight tabs, the same
server-rendered `?tab=` pattern as Claim/Incident Detail:
**Information** / **Status** / **Documents** / **Incidents** / **Claims**
/ **Repair History** / **Warranty** / **Telematics**.

**No original design file was available to build the tab structure
against.** The design (`CM_FIM_System.dc.html`) lives outside this repo
and was never re-shared for M28 — `docs/SCOPE.md`'s one-line summary
names only 5 of the design's stated 8 tabs (Information/Status/
Incident-Claim-Repair history/Warranty/Telematics). Rather than guess at
the other 3 silently, this was raised with the user directly before
building; the 8-tab structure above is this app's own interpretation
(splitting "Incident-Claim-Repair history" into three tabs, adding
Documents), confirmed before writing any code. If the real design
surfaces later, re-point without much rework — the tab content is
already split into independent, swappable sections.

**Warranty is a new model — `provider`/`coverageDescription`/
`startDate`/`endDate`.** Also confirmed with the user before building
(the milestone's own flagged open question in `docs/SCOPE.md`). Basic
terms only, same Phase-1-free-text-field pattern `InsurancePolicy.
insurerName` used before M27 — `provider` is a plain string, not a
master-data table, since nothing asked for a "warranty provider master"
the way the design explicitly named Insurer/Surveyor/Workshop for M27.
Multiple `Warranty` rows per vehicle are allowed (a real vehicle can
carry the manufacturer's original warranty plus a separately-purchased
extended one) — not a one-to-one relationship.

**Incidents/Claims/Repair History reuse a new dedicated query, not
`lib/incidents/incident.ts`'s own `ListIncidentsFilter`.** That filter
is the Incident List page's own contract, shared with its CSV export
(M21) — adding an unrelated `vehicleId` option there would be scope
creep on a different module. `lib/masters/vehicle.ts`'s new
`getVehicleHistory()` runs three independent, already-depot-scoped
queries instead (once `getVehicle()` confirms access to the vehicle,
every incident/claim/repair job under it is visible too — no further
per-row depot check needed).

**Status tab merges the current status + an update form + status-change
history** into one tab rather than a separate Timeline/Audit tab —
keeps the confirmed 8-tab count exactly matching what was agreed, and
status-change history is the one thing actually relevant to a "Status"
tab. Reuses the existing `PATCH /api/vehicles/[id]` (no new endpoint)
and `listAuditLogForEntity()`, filtered to `STATUS_CHANGE` actions.

**Global search and the Vehicles/Fleet list pages now link to the real
detail page.** `lib/search/search.ts`'s vehicle result, `/vehicles`'
own list, and the M25 Fleet Dashboard all previously linked to
`/vehicles/{id}/documents` (the only page that existed) with a comment
predicting "re-point once M28 lands" — done. The old standalone
`app/(app)/vehicles/[id]/documents/page.tsx` was removed rather than
kept as a redirect; nothing else referenced that URL directly, and the
`/vehicles/{id}?tab=documents` deep link on the Vehicles list page's
"Documents" column reaches the same content.

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
- **`lib/masters/master-data.integration.test.ts` (M27, 8 tests)**:
  ORG_ADMIN-only writes for all four entities, any role can read;
  duplicate `(organizationId, name)` rejected; org-scoping (a second
  org's list never contains the first org's rows); `updateInsurer`/
  `updateSurveyor` record UPDATE audit entries; `Surveyor.linkedUserId`
  accepts a real user and rejects a nonexistent one.
- **Backfill verified directly against the dev database** after running
  the migration: every pre-existing `InsurancePolicy`/`Survey` row's new
  FK column resolved to a master row with the exact name/contact the old
  free-text columns held (checked via `psql`, not just application-level
  tests) — see the migration file's own comments for the exact queries.
- **Real HTTP (M27), against the built app**: `/admin/master-data`'s four
  tabs each render their list + create form; creating an Insurer/
  Surveyor/Workshop through the UI and then opening a Claim's "Schedule
  survey"/"Open repair job" form shows it in the dropdown; unauthenticated
  `/api/admin/insurers` → `401`.
- **`lib/masters/warranty.integration.test.ts` (M28, 6 tests)**:
  ORG_ADMIN and depot-scoped DEPOT_MANAGER can create, CLAIMS_MANAGER
  cannot; a DEPOT_MANAGER cannot create a warranty for another depot's
  vehicle; `endDate` before/equal to `startDate` rejected (`ZodError`);
  multiple warranties on the same vehicle are allowed; `listWarrantiesForVehicle`
  is depot-scoped the same way as the vehicle itself; `updateWarranty`
  records an UPDATE audit entry.
- **`lib/masters/vehicle-history.integration.test.ts` (M28, 1 test)**:
  `getVehicleHistory()` returns exactly one vehicle's own incidents/
  claims/repair jobs, correctly excluding a second vehicle's, with the
  claim's `incident` and the repair job's `workshop` both present via
  `include`.
- **Real HTTP (M28), against the built app**: all 8 tabs of
  `/vehicles/{id}` render real data for a seeded vehicle; the Status
  tab's inline update form actually changes status and the change shows
  up in the status-history table on refresh; the Warranty tab's create
  form adds a warranty and it appears in the list; the global search
  vehicle result and the Vehicles/Fleet list pages all link to the new
  detail page, not the retired documents-only page; unauthenticated
  `/vehicles/{id}` redirects to `/login`.
