# Incident Workflow — M6

Status: implemented (`lib/incidents/*.ts`, `app/api/incidents/**`,
`app/incidents/*`) · verified via integration tests and real HTTP against
the built app (see "Verification" below).

Covers: incident creation/editing, the OPEN/CLOSED state machine,
human-readable `INC-YYYY-######` ID generation, and photo/video/document
evidence attachment (reusing M5's presigned-upload pattern). Telematics
snapshot capture is **not** this milestone — that's M12.

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

## Deferred to a follow-up

- **CSV/bulk incident import** — not part of this milestone, same
  reasoning as M4/M5.
- **Telematics snapshot at incident-report time** — M12, per
  `docs/SCOPE.md`; the schema (`TelematicsSnapshot`) already exists from
  M2a but nothing writes to it yet.
- **Incident → claim conversion** — M7. Nothing in this milestone assumes
  or blocks it; `Claim.incidentId` and the M2b schema are already in
  place for M7 to build against.
