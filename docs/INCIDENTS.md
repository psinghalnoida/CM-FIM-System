# Incident Workflow — M6

Status: implemented (`lib/incidents/*.ts`, `app/api/incidents/**`,
`app/incidents/*`) · verified via integration tests and real HTTP against
the built app (see "Verification" below).

Covers: incident creation/editing, the OPEN/CLOSED state machine,
human-readable `INC-YYYY-######` ID generation, and photo/video/document
evidence attachment (reusing M5's presigned-upload pattern). Telematics
snapshot capture is **not** this milestone — that's M12.

**Update (M21):** Incident List gained richer filters (severity, type,
depot, date range) and a CSV export; Incident Detail became the design's
7-tab layout (Overview/Evidence/Telematics/Documents/Assessment/
Timeline/TAT). See "M21: Incident List + Detail" below.

## M21: Incident List + Detail

**Two new nullable fields, `injuries` and `thirdPartyInvolved`.** The
design's Overview tab shows these as structured fields in the Driver
section, not buried in free-text `description`. Both optional — filled
in as the picture becomes clearer, not required at intake. No UI existed
to edit *any* incident field before this (only create existed); a small
inline form on the Overview tab is the minimal path to setting these two,
not a general-purpose incident-edit page (out of scope here).

**A `depotId` list filter never becomes a cross-depot bypass for
`DEPOT_MANAGER`.** `listIncidents` already forces `depotId: depotScope`
for a `DEPOT_MANAGER`; the M21 addition is that if such a session also
passes an explicit `filter.depotId` for a *different* depot, the function
returns `[]` rather than silently AND-ing the two into a query that
happens to match nothing — the same "don't let a filter produce a
confusing empty result via a query collision" call made elsewhere in this
codebase (e.g. the M18 `DEPOT_MANAGER`-with-no-depot check).

**Export is CSV**, not XLSX/PDF — the design's "Export" button doesn't
specify a format; CSV is the simplest one that opens directly in any
spreadsheet tool, and the sensible default for an ops export with no
format requirement given.

**Telematics tab is a placeholder, not built against real data.**
`TelematicsSnapshot` (BR-06) has existed in the schema since M2a but
nothing has ever written to it — the capture job is M12's job, gated on
JBM FMS API access, exactly as `docs/SCOPE.md` already flags. Rendering
an empty/fake tile grid against a model with zero rows would be worse
than an honest "not available yet" message.

**Assessment tab reuses existing data — no new "classification" field.**
The design shows a read-only classification radio group whose four
options (Warranty/Maintenance/Operational/Insurance) are literally the
existing `ClaimType` enum — that choice is already made at claim-creation
time via the existing "File a claim"/"Convert to claim" flow, so the tab
just surfaces the incident's description plus that same call-to-action,
rather than adding a field that would duplicate `ClaimType`.

**Timeline tab reuses `AuditLog`** via M19's `listAuditLogForEntity()`
against `entityType: "Incident"` — the same pattern as every other
Timeline/Audit tab in the app, not a new mechanism.

**Documents tab is document-linking extended to `INCIDENT`** — the
follow-up `lib/documents/link-scope.ts`'s own code comment had predicted
since M5/M19 ("INCIDENT ... will need a case added here once their
owning module exists"). Write RBAC mirrors `lib/incidents/incident.ts`'s
own `WRITE_ROLES` (`ORG_ADMIN`, `DEPOT_MANAGER`) — which happens to equal
the pre-existing `VEHICLE`/`DRIVER` default, but is listed explicitly in
`WRITE_ROLES_BY_ENTITY_TYPE` rather than left to that coincidence.

## Design decisions and why

**Incident status stays OPEN/CLOSED — no new states added.** The schema
already had just these two (M2a). An incident's real workflow detail
(survey scheduled, under repair, awaiting settlement, ...) lives on its
derived `Claim`(s) via `Claim.status` and the TAT engine (M2b), not on the
incident itself — the incident is closer to "still needs attention" vs.
"nothing more to do here" than a detailed pipeline. `closeIncident()`/
`reopenIncident()` are explicit actions with their own RBAC and audit
entries, and reject a transition that's already in the target state
(`DomainError`, 409) rather than silently no-op'ing.

**Closing an incident has no claim-aware checks yet.** BR-09 ("a claim
cannot be finally closed until settlement/payment is satisfied") applies
to *Claim* closure, not *Incident* closure — the two are different
actions on different records. Since M7 (claims) doesn't exist yet,
incident closure today is purely administrative. Revisit if/when a real
need emerges for "don't let an incident close while a derived claim is
still open" — not obviously the right rule (an incident can spawn a claim
that reasonably outlives the incident being "administratively done"), so
it's deliberately not assumed now.

**RBAC mirrors M4/M5 exactly: ORG_ADMIN + depot-scoped DEPOT_MANAGER.** A
DEPOT_MANAGER can report/edit/close incidents for vehicles in their own
depot only; every other role isn't given write access to incidents at
all in this milestone (see the chat record for the alternative
considered — open reporting to any authenticated role — and why the
consistent-with-precedent option was chosen instead). Read access has no
role restriction — same as vehicles/drivers/documents — but is still
depot-scoped for DEPOT_MANAGER via `Incident.depotId` directly (no lookup
through a related entity needed, unlike documents' `link-scope.ts`,
since `depotId` is a direct column on `Incident`).

**`Incident.depotId` is set from the vehicle's depot at creation time, not
asked for separately.** The vehicle a report is about already has a
depot; asking the reporter to also pick a depot would be redundant and a
source of drift if the two ever disagreed. It's a plain column copy at
create time, not a live foreign-key-through-vehicle lookup, so it stays
correct even if the vehicle is later transferred to a different depot —
the incident happened at whatever depot the vehicle belonged to *then*.

**A driver on an incident is validated to exist in the org, but not
depot-matched to the vehicle.** A driver can legitimately be operating a
vehicle temporarily assigned from another depot; requiring an exact depot
match would reject a real scenario for no safety benefit — the vehicle's
depot (already validated via `assertDepotInScope`) is what governs the
incident's access control.

**Evidence reuses the exact presigned-upload pattern from M5**
(`lib/incidents/evidence.ts` mirrors `lib/documents/document.ts`), but
simpler: evidence isn't versioned — it's captured once, with a `caption`
and `evidenceType` (PHOTO/VIDEO/DOCUMENT), no version history. Access is
resolved through the parent `Incident` (which has a direct
`organizationId`/`depotId`), not a generic link table.

**A real bug found and fixed while building this: `Evidence` has no
`organizationId` column** (per `docs/schema/M2A.md` — it's a detail table
reached through `Incident`), so `scopedDb(...).evidence.findUniqueOrThrow(...)`
does **not** filter by org — `scopedDb()` only touches models listed in
`ORG_SCOPED_MODELS`. An early version of `getEvidenceDownloadUrl()` used
`scopedDb` directly on `Evidence` and would have let a user fetch another
organization's evidence download URL by ID. Fixed by querying the plain
`db` client with `include: { incident: true }` and an explicit
`evidence.incident.organizationId !== session.user.organizationId` check
before trusting anything else about the row — exactly the gap
`ORG_SCOPED_MODELS`/`lib/scoped-db.guard.test.ts` exists to catch, caught
by code review before it shipped rather than by that test (which only
guards the list itself, not every call site).

**A second, smaller fix made while building this: `DomainError` — expected
business-rule violations now map to real HTTP status codes.** Before this
milestone, a plain `throw new Error(...)` for something like "incident is
already closed" fell through `lib/api-errors.ts`'s catch-all and surfaced
as a generic `500 Internal Server Error` — found via the real HTTP
walkthrough below, not a test (none of the existing tests asserted on the
*status code* of a rejected promise, only that it rejected). `lib/domain-error.ts`
adds a small `DomainError` class carrying its own HTTP status; call sites
across `lib/incidents/incident.ts`, `lib/documents/document.ts`,
`lib/documents/link-scope.ts`, and `lib/incidents/evidence.ts` were
updated to throw it instead of a plain `Error` for conditions a client can
actually act on (already-closed → 409, unsupported link type → 400,
oversized upload → 400, cross-org evidence → 404) — reserving a plain
`Error`/500 for genuine internal-invariant violations (e.g. "a document
has no link to check access against," which should never happen and isn't
something a client did wrong).

## Verification

- **`lib/incidents/incident.integration.test.ts`** (7 tests, real
  Postgres): `INC-YYYY-######` generated sequentially within an org/year
  and inherits the vehicle's depot; DEPOT_MANAGER confined to their own
  depot on create/read/list; a role with no write access (CLAIMS_MANAGER)
  is rejected; OPEN → CLOSED → OPEN transitions with audit entries for
  each, and a double-close is rejected; `listIncidents`' status filter.
- **`lib/incidents/evidence.integration.test.ts`** (5 tests, real
  Postgres + a real S3-compatible server on a second port so it can run
  concurrently with the document repository's own test server — see the
  file header for the module-load-timing subtlety this required):
  evidence created from real uploaded S3 content with the correct
  `fileSizeBytes`; DEPOT_MANAGER depot-scoped; oversized upload rejected
  and the S3 object actually deleted; a presigned download URL serves the
  exact uploaded bytes; DEPOT_MANAGER cannot read another depot's
  evidence.
- **A pre-existing flakiness class fixed while adding these files**: all
  four `*.integration.test.ts` files' `unique()` helper used only a
  per-file counter, with no cross-process entropy — `User.email` has a
  *global* unique constraint, so two test files running concurrently
  against the same shared Postgres could generate the identical string
  (e.g. `"ORG_ADMIN1@example.com"`) and collide. Hit once during this
  milestone's own test runs. Fixed everywhere by adding a random suffix,
  not just here.
- **Real HTTP, against the built app + a separately-started s3rver
  instance**: create incident → confirmed `INC-2026-000001`-shaped number
  → presign/PUT/complete evidence upload → download URL served the exact
  uploaded bytes → detail page rendered both → close (200) → close again
  (**409**, not 500 — the bug described above, caught here) → reopen
  (200) → a DEPOT_MANAGER from a different depot attempting to create an
  incident against another depot's vehicle → **403**.
- **`lib/incidents/incident.integration.test.ts`** (M21, +2 tests):
  `injuries`/`thirdPartyInvolved` both start null and are independently
  settable via `updateIncident`; `listIncidents` filters by severity,
  incidentType, depotId, and date range correctly, and a `DEPOT_MANAGER`
  explicitly filtering by another depot gets an empty list (not a
  cross-depot leak, checked by asserting the actual returned rows).
- **`lib/documents/document.integration.test.ts`** (M21, +1 test):
  `DEPOT_MANAGER` can upload an incident document, `CLAIMS_MANAGER`
  cannot; `listDocumentsForEntity` returns it.
- **Real HTTP (M21), against the built app**: filtered `/incidents` by
  severity/type — **200**; CSV export returned real rows with the
  correct header row; set `injuries`/`thirdPartyInvolved` via `PATCH`
  and confirmed the Overview tab rendered them; all 7 tabs render
  (**200**) including the Telematics placeholder's "deferred to M12"
  text; a `DEPOT_MANAGER` presigning an upload for another depot's
  incident got **403**, the same `DEPOT_MANAGER` presigning for their
  own depot's incident succeeded; unauthenticated requests to the new
  tabbed page redirect (**307**).

## Deferred to a follow-up

- **CSV/bulk incident import** — not part of this milestone, same
  reasoning as M4/M5.
- **Telematics snapshot at incident-report time** — M12, per
  `docs/SCOPE.md`; the schema (`TelematicsSnapshot`) already exists from
  M2a but nothing writes to it yet.
- **Incident → claim conversion** — M7. Nothing in this milestone assumes
  or blocks it; `Claim.incidentId` and the M2b schema are already in
  place for M7 to build against.
