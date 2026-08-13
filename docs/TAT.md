# TAT Engine — M8

Status: implemented (`lib/tat/*.ts`, `app/api/tat/**`, `app/tat/*`) ·
verified via integration tests and real HTTP against the built app (see
"Verification" below).

Covers: configurable stage templates per org/case-type (PR-01),
auto-instantiated `CaseStageInstance` tracking against them, on-hold
periods with reason/responsible party (PR-02), and elapsed-time
calculation that excludes held time. **Not** this milestone: actually
firing escalations (PR-03's configuration table, `EscalationRule`,
already exists per M2b, but nothing consumes it — that's M13).

**Update (M23):** a TAT Dashboard (`/tat/dashboard`) — a live board of
every active stage across incidents and claims — landed on top of this
engine. No new schema. See "M23: TAT Dashboard" below.

## M23: TAT Dashboard

**"Active" means `IN_PROGRESS` or `ON_HOLD` — not a report of history.**
The design calls for "every in-progress case's TAT status," which this
reads literally: a stage that has actually started and hasn't finished
yet. `PENDING` stages haven't started their clock (nothing to show) and
`COMPLETED` ones are done (that's M24's MIS Reports' TAT-compliance job,
a rollup of *history*, not a live board). `lib/tat/dashboard.ts`'s
`getTatDashboard()` is a new, separate aggregation — it doesn't touch
`listStageInstancesForCase()` (still per-case, unchanged) or
`getOperationalDashboard()`'s own `tatBreaches.topBreached` (still a
capped top-10 preview inside the M9 dashboard) — this is the first place
in the app showing the *complete*, unfiltered active-stage list.

**Breach detection reuses `computeElapsedTime()` verbatim** — same
`netHours > targetHours` math as everywhere else, not a second
"breached" definition based on `dueAt < now` (the check
`getOperationalDashboard()`'s `tatBreaches` section uses, which is a
convenient DB-level filter for a different purpose: `dueAt` doesn't
always exactly track the hold-adjusted net elapsed time, e.g.
immediately after a hold starts). To let `computeElapsedTime()` be
called without loading a stage's full `incident`/`claim` relations,
`case-stage.ts` now exposes it against a narrower structural
`ElapsedTimeInput` type instead of the full `LoadedStageInstance` it used
before — a signature change with no behavior change, that also let M24
reuse it without an unnecessary `include`.

**Filters: depot, case type, breached-only.** Case type is the *real*
`CaseType` enum (`INCIDENT`/`INSURANCE_CLAIM`/`WARRANTY_CLAIM`/
`MAINTENANCE_CLAIM`/`OPERATIONAL_CLAIM`) read straight off each stage's
`TatStageTemplate.caseType` — not a re-derived incident-vs-claim binary —
since that's the real, existing distinction `TatStageTemplate` already
makes and every case type is meaningful to filter by, not just the two
broad kinds. Depot-scoped for `DEPOT_MANAGER` with the same "an
out-of-scope `depotId` filter returns an empty board, not a bypass"
pattern used everywhere else in this codebase.

## Design decisions and why

**`TatStageTemplate` configuration is `ORG_ADMIN`-only; every
authenticated role reads it.** Stage names/order/TAT targets are
organization-wide policy, the same tier as things only an admin tunes —
not day-to-day claims work like `CLAIMS_MANAGER`'s other M7
responsibilities. Reads have no role restriction since stage
names/targets need to be visible anywhere a case is shown.

**`CaseStageInstance` rows are auto-instantiated at case creation, not
created manually.** `instantiateStagesForCase()` runs inside
`createIncident()`'s and `createClaim()`'s own transaction (never opens
its own) and creates one row per active `TatStageTemplate` matching the
org/case type. This is what makes PR-01 ("every workflow stage has a
configurable TAT") an always-on mechanism rather than something a busy
user might forget to set up — TAT tracking exists the moment a case
exists, for every case, or not at all if the org hasn't configured any
stages for that case type yet (a real, non-error state: `templates.length
=== 0` is a silent no-op, not a `DomainError`).

**One `CaseType` per `ClaimType`, keyed off the claim's own type — not
the incident's.** `CASE_TYPE_BY_CLAIM_TYPE` in `lib/claims/claim.ts` maps
`INSURANCE → INSURANCE_CLAIM`, etc. (the enums mirror each other 1:1,
`_CLAIM` suffix). An incident and its claims track separate stage
pipelines — filing an `INSURANCE` claim against an incident does not
touch the incident's own `INCIDENT`-typed stages, and a `MAINTENANCE`
claim only ever sees `MAINTENANCE_CLAIM` templates, never
`INSURANCE_CLAIM` ones, even for the same incident.

**Stages are sequential — one active stage per case at a time.** At
creation, only the first stage (by `sequenceOrder`) starts `IN_PROGRESS`
with its TAT clock running (`dueAt = now + targetHours`); the rest sit
`PENDING` with no `dueAt` yet (an unstarted clock has nothing to compute).
`completeStage()` **automatically starts the next `PENDING` stage** for
the same case when one exists — this is the actual point of "sequential":
without auto-advance, "one active stage at a time" would mean two manual
actions (complete this, then remember to start that) for every step, and
a forgotten second step would silently leave a case with *no* active
stage and untracked TAT. There's no `startStage()` function in the public
API at all — a stage only ever becomes `IN_PROGRESS` via auto-instantiation
(first stage) or auto-advance (every stage after).

**No new "TAT role" — write access mirrors whoever already owns the
subject.** `assertCanManageStage()` branches on which parent is set:
incident-typed stages use M6's incident RBAC (`ORG_ADMIN` + depot-scoped
`DEPOT_MANAGER`); claim-typed stages use M7's claim RBAC (`ORG_ADMIN` +
org-wide `CLAIMS_MANAGER`). TAT actions (complete/hold/end-hold) are just
another thing the people already managing the incident or claim do — not
a reason to invent a new permission dimension.

**PR-02's held-time exclusion is implemented two ways, deliberately kept
consistent, not merged into one:**
1. `CaseStageInstance.dueAt` is a stored, fast "is this stage overdue"
   check — recomputed by `endHold()`, which extends it by exactly the
   ending hold's duration (`docs/schema/M2B.md`'s own comment: "recomputed
   whenever a hold period ends"). Cheap to read anywhere a due date needs
   showing, with no per-read aggregation.
2. `computeElapsedTime()` independently sums every hold period's duration
   against the wall-clock time since `enteredAt`, producing
   `elapsedHours`/`heldHours`/`netHours`/`breached` — a real "elapsed time
   excluding holds" calculation for reporting (e.g. "3.5h elapsed, 1.2h on
   hold, 2.3h net against an 8h target"), not just an implicit side effect
   of `dueAt` bookkeeping.

Both converge on the same answer (net elapsed vs. target ⇔ now vs. dueAt)
because `dueAt`'s extension is exactly the same hold-duration math
`computeElapsedTime()` does independently — this was checked directly in
`case-stage.integration.test.ts`'s hold test, not just asserted in
comments.

**Ending a hold sets the stage back to `IN_PROGRESS`, never anything
else.** A stage can only be placed on hold from `IN_PROGRESS` (checked by
`startHold()`), so the one place it can return to is unambiguous.
Completing a held stage is refused with a clear message ("end the active
hold first") rather than silently ending the hold as a side effect of
completion — two explicit actions, not one action doing two things.

## Verification

- **`lib/tat/dashboard.integration.test.ts` (M23, 1 test)** — active-stage
  selection (excludes `PENDING`/`COMPLETED`), breach flagging, the
  `caseType`/`breachedOnly` filters, `DEPOT_MANAGER` depot-scoping, and
  the out-of-scope-`depotId` → `[]` case.
- **`lib/tat/stage-template.integration.test.ts`** (3 tests, real
  Postgres): RBAC (`ORG_ADMIN` writes, `CLAIMS_MANAGER` rejected); a
  duplicate `(organizationId, caseType, stageKey)` is rejected (the
  schema's own unique constraint); update + audit; listing ordered by
  `sequenceOrder`.
- **`lib/tat/case-stage.integration.test.ts`** (11 tests): auto-
  instantiation produces the right IN_PROGRESS-then-PENDING shape, and is
  a no-op with nothing configured; `createClaim` keys off the claim's own
  case type, independent of the incident's stages; `completeStage()`
  auto-advances the next `PENDING` stage (and does nothing extra when
  there isn't one); completing a `PENDING` or already-`COMPLETED` stage
  is rejected (409); the full hold/end-hold cycle, including a
  precisely-measured `dueAt` extension (a hold's `startedAt` is moved 2
  hours into the past via direct DB write, then `endHold()`'s resulting
  `dueAt` shift is asserted to land within a tight tolerance of exactly 2
  hours); starting a hold on a non-`IN_PROGRESS` stage and ending a hold
  on a non-`ON_HOLD` stage are both rejected (409); `computeElapsedTime`
  nets held time out of the wall-clock elapsed; RBAC/depot-scope for both
  incident-typed and claim-typed stages, including a `DEPOT_MANAGER`
  correctly rejected from managing a claim-typed stage (claims aren't
  `DEPOT_MANAGER`'s to manage at all, per M7).
- **Real HTTP, against the built app**: created two `INCIDENT`-typed
  stage templates (seq 0/1) → created an incident → **both stages
  auto-instantiated exactly as designed** (stage 1 `IN_PROGRESS` with a
  real `dueAt`, stage 2 `PENDING` with `dueAt: null`) → started a hold on
  stage 1 → completing a held stage rejected (**409**, "end the active
  hold first") → starting a second hold while already on hold rejected
  (**409**) → ended the hold (`dueAt` shifted forward by the hold's real
  duration) → completed stage 1 → **stage 2 auto-advanced to
  `IN_PROGRESS`** with its own `dueAt` computed from that moment →
  completing stage 1 again rejected (**409**, already `COMPLETED`) →
  `/tat/stage-templates` and the incident detail page's new TAT stages
  section both rendered the real data → unauthenticated
  `/api/tat/stage-instances` rejected with **401**.

## Deferred to a follow-up

- **Escalation firing** — `EscalationRule` is configuration-only since
  M2b; nothing reads or acts on it yet. M13, per `docs/SCOPE.md`.
- **`EscalationRule` CRUD** — not part of this milestone's scope either
  (the M8 row in `docs/SCOPE.md` doesn't list it); build it alongside
  M13 when there's a real firing mechanism to configure against, same
  reasoning as M2b's own note that an `EscalationEvent` log table would
  be "a table with no writer" today.
- **Dashboards / breach reporting** — M9 consumes `computeElapsedTime`'s
  `breached` flag and `CaseStageInstance.dueAt` for real aggregate views;
  this milestone only exposes the per-stage numbers, not a rollup.
- **Skipping/reordering stages** (e.g. a `REJECTED` claim doesn't need
  its remaining stages tracked) — not built. A rejected claim's later
  `PENDING` stages simply never advance, which is honest (nothing false
  is reported) even if not tidy; revisit if a real reporting need shows
  up.
