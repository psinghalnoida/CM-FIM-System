# Operational Dashboard — M9

Status: implemented (`lib/dashboards/operational-dashboard.ts`,
`app/api/dashboards/operational`, `app/dashboards/*`) · verified via
integration tests and real HTTP against the built app (see
"Verification" below).

Covers: incident/claim status counts, TAT breach counts, and aging
(days-open buckets), backed entirely by live queries against real data —
no mocks, no cached/materialized rollups.

## Design decisions and why

**One shared aggregation, not separate "corporate" and "depot"
dashboards.** `getOperationalDashboard(session, { depotId? })` computes
the exact same counts/aging/breaches either org-wide or narrowed to one
depot — a `depotId` filter, not a second implementation. `DEPOT_MANAGER`'s
own depot (`depotScopeFor()`) always overrides whatever `depotId` a
caller passes, the same defense-in-depth pattern `lib/masters/depot-scope.ts`
already uses elsewhere; every other role sees org-wide by default and can
optionally narrow to one depot via the same parameter. There's no
separate "claim dashboard" either — claim status counts, claim aging, and
claim-stage TAT breaches are columns/rows in the one result, not a fourth
view, since duplicating the query shape per audience would just be the
same numbers computed three ways.

**Read access has no role restriction, same as every other read-heavy
view in this codebase** (`getIncident`, `getClaim`, ...) — depot-scoping
for `DEPOT_MANAGER` is what actually protects anything sensitive here,
not a role gate.

**Aging buckets are 0-3 / 4-7 / 8-14 / 15+ days**, computed from
`Incident.reportedAt` and `Claim.openedAt` (both already exist and mean
"entered our system," not "when the event happened" — `incidentDateTime`
can be backdated for a late report). Bucketed by whole days elapsed
(`Math.floor`), so a case that's 3 days and 5 hours old still counts as
"0-3" — an intentional simplification; day-boundary precision isn't worth
more code for an aggregate dashboard.

**A claim counts as "still open" for aging until it reaches `CLOSED` or
`REJECTED` — `SETTLED` still counts.** `SETTLED` means the money side is
resolved but the record isn't formally closed yet (BR-09's gate, M14);
excluding it from aging would hide a claim that's administratively
lingering even after settlement. Only the two real terminal statuses stop
the aging clock.

**TAT breach counting only looks at `IN_PROGRESS` stages whose `dueAt`
has passed — an `ON_HOLD` stage is excluded even if its (pre-hold) `dueAt`
is in the past.** An `ON_HOLD` stage's clock is explicitly paused (PR-02)
— counting it as an active breach would misattribute a delay to the
handling team while, e.g., the customer is the actual blocker. This
isn't a loophole: `endHold()` (M8) extends `dueAt` by exactly the hold's
duration, so a stage that was genuinely overrunning before the hold
started will correctly show breached again once it resumes and the
extended `dueAt` still passes.

**`topBreached` is capped at 10, most-overdue first — a dashboard
preview, not a report export.** The `totalCount`/`incidentStageCount`/
`claimStageCount` numbers are exact (computed from the same query, not
sampled); only the itemized list is bounded. A full breach *report*
(unbounded, filterable, exportable) isn't this milestone's job.

**Everything is a live query at request time — no caching, no
materialized rollup table.** Dataset sizes in this phase don't warrant
it, and a stale cached count would be actively misleading on a
dashboard whose entire point is "what's true right now." Revisit only if
a real performance problem shows up with production-scale data.

## Verification

- **`lib/dashboards/operational-dashboard.integration.test.ts`** (7
  tests, real Postgres): incident/claim status counts; aging buckets
  across all four ranges for both incidents and claims (ages set via
  direct `reportedAt`/`openedAt` writes for determinism); a `CLOSED`
  incident and a `CLOSED`/`REJECTED` claim are excluded from aging; an
  overdue `IN_PROGRESS` stage counts as a breach while an overdue
  `ON_HOLD` stage (same past `dueAt`) does not; `depotId` narrows the
  dashboard to one depot; a `DEPOT_MANAGER`'s own depot overrides a
  passed `depotId`; a second organization's data never appears in the
  first org's dashboard.
- **Real HTTP, against the built app**: two incidents (one closed) →
  dashboard showed `OPEN: 1, CLOSED: 1` and the open one correctly aged
  into the `0-3` bucket → created a 1-hour-target stage template, a new
  incident (auto-instantiating it `IN_PROGRESS`), pushed its `dueAt` 3
  hours into the past directly in Postgres (no API surfaces `dueAt`
  editing, by design) → the dashboard showed exactly **1 TAT breach**,
  ~3.0 overdue hours, correctly labeled with the incident's own
  `INC-2026-######` number → the same breach still appeared correctly
  when filtered to its depot via `?depotId=...` → `/dashboards` rendered
  the real data, including the breach row → unauthenticated
  `/api/dashboards/operational` rejected with **401**.

## Deferred to a follow-up

- **A dedicated "claim dashboard" view / drill-down UI** — the
  aggregation already includes claim-specific numbers; a richer
  claims-focused page (e.g. by claim type, by assignee) is a UI-only
  addition on top of data this milestone already computes, not built now
  since nothing asked for it yet.
- **Caching/materialization** — deliberately not built; see above.
- **Historical trend charts** (breach counts over time, etc.) — this
  milestone only reports the current snapshot.
- **CSV/export of the full breach list** — `topBreached` is a capped
  preview, not an export path.
