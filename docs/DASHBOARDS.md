# Operational Dashboard — M9

Status: implemented (`lib/dashboards/operational-dashboard.ts`,
`app/api/dashboards/operational`, `app/dashboards/*`) · verified via
integration tests and real HTTP against the built app (see
"Verification" below).

Covers: incident/claim status counts, TAT breach counts, and aging
(days-open buckets), backed entirely by live queries against real data —
no mocks, no cached/materialized rollups.

**Update (M21):** the design's "Corporate Dashboard richness" ask —
a pipeline funnel and a depot-performance breakdown — added to the same
`getOperationalDashboard()` computation, not a second dashboard. See "M21:
Pipeline funnel + depot performance" below.

**Update (M24-M26):** three more read-only views landed alongside this
one — MIS Reports, the Fleet Dashboard, and My Work — each its own new
aggregation module, none touching `getOperationalDashboard()` itself.
See their own sections below.

## M21: Pipeline funnel + depot performance

**The pipeline funnel is an interpretive relabeling of counts this
dashboard already computed, not a new concept.** The design names six
stages (Assessment/Claim/Survey/Repair/Settlement/Payment); nothing in
the schema stores a case's "pipeline stage" as a first-class value, so
`pipelineFunnel` maps each name onto the closest existing status count:
`assessment` = still-`OPEN` incidents (not yet converted to a claim),
`claim`/`survey`/`repair`/`settlement` = the matching `ClaimStatus`
count, `payment` = `SETTLED` claims (money resolved, awaiting formal
`CLOSED`). This is a judgment call, not a literal spec, flagged here
rather than presented as an exact mapping — revisit if the funnel needs
to mean something more precise once real usage shows what JBM actually
wants read off it.

**Depot performance respects the same `depotId` filter as everything
else on this dashboard** — M9's own rule ("one shared computation,
narrowed by the same filter," not a special case per section) — rather
than always showing every depot regardless of the filter. Unfiltered
(the common case) it's a real per-depot comparison; filtered to one
depot, or for a `DEPOT_MANAGER` whose scope is already pinned, it
correctly collapses to a one-row table instead of showing other depots'
rows as misleading zeros.

## M24: MIS Reports

`lib/reports/mis.ts`'s `getMisReport()` — claim ageing, TAT compliance %,
incident-type frequency, and repair turnaround by depot. Four new
aggregation queries against existing data (`Claim`/`CaseStageInstance`/
`Incident`/`RepairJob`); no new models, no new stored metrics.

**Claim ageing reuses M9's exact bucket definition** —
`lib/dashboards/operational-dashboard.ts`'s `AGE_BUCKETS`/`ageBucket()`/
`emptyBuckets()`/`CLAIM_TERMINAL_STATUSES` are now exported and imported
here rather than redefined, so "how old is an open claim" can never
drift into two different answers depending on which page you're looking
at.

**TAT compliance is a real %, not a stored field.** For every `COMPLETED`
stage org-wide (or depot-filtered), `computeElapsedTime()` (M23's
narrower `ElapsedTimeInput` signature) decides compliant vs. breached;
`compliancePercent` is `null` — not `0` — when there are zero completed
stages to measure yet, the same "no data ≠ 0%" call M22's
`averageOcrConfidence()` made.

**Repair turnaround by depot averages `endDate - startDate` in days**,
per depot (via `RepairJob → Claim → Incident.depotId`), only over jobs
that actually have both dates set (an in-progress job with no `endDate`
isn't "0 days," it's not measurable yet — excluded, not counted as
instant).

## M25: Fleet Dashboard

`lib/fleet/fleet-dashboard.ts` — fleet-wide KPIs (`getFleetKpis()`) and a
filterable vehicle list (`listFleetVehicles()`, by status/depot/has-open-
incidents/has-open-claims). New aggregation over existing `Vehicle`/
`Incident`/`Claim` data; no new models.

**"Open incidents/claims" per vehicle reuses the exact same status
definitions M9 already uses** (`IncidentStatus.OPEN`;
`CLAIM_TERMINAL_STATUSES` for claims) rather than inventing a second
notion of "open" specific to the fleet view — the same reasoning as
M24's ageing-bucket reuse above.

**The design's "Missing" KPI tile has no equivalent here either** — same
call as M22's Document Repository: nothing defines which documents (or
any other completeness criterion) a vehicle "should" have, so there's
nothing to compute a missing-count against. Only real, computed KPIs
ship (Active/Inactive counts, vehicles-with-open-incidents/claims).

## M26: My Work

`lib/my-work/my-work.ts`'s `getMyWork()` — a personalized "needs your
action" view, scoped to the caller's role. No new schema, and
deliberately **not** filtered to "assigned to me": nothing in this app
tracks per-user assignment except `Survey.surveyorUserId` (nullable, set
only when the surveyor is an internal user) — and even that isn't who's
*allowed* to act, since any user with the `SURVEYOR` role can update any
survey (`lib/claims/survey.ts`'s `WRITE_ROLES`). Building a real
per-user assignment system wasn't asked for and would be new schema for
a milestone that explicitly has none — so "needs your action" here means
"what your role's own module already lets it act on, that hasn't
reached a terminal state yet," reusing each module's own `WRITE_ROLES`
and status definitions rather than inventing a parallel notion:

| Role | Sees |
|---|---|
| `ORG_ADMIN` | The union of every row below, org-wide (can act on all of them) |
| `DEPOT_MANAGER` | Open incidents at their own depot + incident-typed active TAT stages there |
| `CLAIMS_MANAGER` | Non-terminal claims, org-wide + claim-typed active TAT stages |
| `SURVEYOR` | `SCHEDULED`/`IN_PROGRESS` surveys, org-wide |
| `WORKSHOP_COORDINATOR` | Non-terminal repair jobs, org-wide |
| `FINANCE_OFFICER` | Non-`ACCEPTED` settlements + unreconciled payments, org-wide |
| `AUDITOR` | Nothing — explicitly empty, not an invented list, since `AUDITOR` is read-only everywhere |
| `SUPER_ADMIN` / `WHATSAPP_BOT` | Nothing — system/support principals, not expected to open this page |

**TAT stage items reuse M23's `getTatDashboard()` directly**, filtered
client-side by whether each row's `caseType` is `INCIDENT` (for
`DEPOT_MANAGER`) or one of the claim types (for `CLAIMS_MANAGER`) —
`ORG_ADMIN` gets both, unfiltered. No separate stage query.

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
- **`lib/dashboards/operational-dashboard.integration.test.ts`** (M21,
  +2 tests): the pipeline funnel correctly counts a still-`OPEN`
  incident as `assessment`, a fresh claim as `claim`, and a claim walked
  to `UNDER_SURVEY` as `survey`, with `repair`/`settlement`/`payment`
  correctly at zero; depot performance breaks down open incidents/claims
  per depot when unfiltered, and collapses to one row when filtered to a
  single depot.
- **Real HTTP (M21), against the built app**: `/dashboards` rendered
  both new sections — the pipeline funnel tiles and the depot
  performance table — with real counts.
- **`lib/reports/mis.integration.test.ts` (M24, 1 test)**: claim ageing
  bucket counts across a fresh and a 10-day-old open claim; TAT
  compliance % across one compliant and one breached completed stage
  (50%); incident-type frequency counts; repair turnaround averaged
  correctly for a real 10-day start-to-end job, `null`/zero for a depot
  with no completed jobs; depot filtering and `DEPOT_MANAGER`
  cross-depot → empty report.
- **`lib/fleet/fleet-dashboard.integration.test.ts` (M25, 1 test)**: KPI
  counts (status breakdown, vehicles-with-open-incidents/claims); the
  `status`/`hasOpenIncidents`/`hasOpenClaims` filters each narrow
  correctly; `DEPOT_MANAGER` depot-scoping and the cross-depot → `[]`
  case.
- **`lib/my-work/my-work.integration.test.ts` (M26, 1 test)**: seeded one
  of every category (an open incident, a claim with its own survey/
  repair-job/settlement/unreconciled-payment, and both an incident-typed
  and a claim-typed active TAT stage), then asserted each of
  `DEPOT_MANAGER`/`CLAIMS_MANAGER`/`SURVEYOR`/`WORKSHOP_COORDINATOR`/
  `FINANCE_OFFICER` sees exactly its own category (+ the right TAT
  stages), `AUDITOR` sees `[]`, and `ORG_ADMIN` sees the full union.

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
