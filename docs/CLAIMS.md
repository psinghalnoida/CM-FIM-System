# Claim Workflow — M7

Status: implemented (`lib/claims/*.ts`, `app/api/claims/**`, `app/claims/*`)
· verified via integration tests and real HTTP against the built app (see
"Verification" below).

Covers: incident→claim conversion (a claim is always filed against an
existing `Incident`, never re-created — BR-01), multi-claim-per-incident,
claim types, BR-05 policy auto-selection, the `ClaimStatus` state machine
(`CLM-YYYY-######`), and the two claim sub-workflows this milestone builds
alongside it — surveys (`SUR-YYYY-######`) and workshop/repair jobs
(`RepairJobStatus`, `WorkshopActivity` logging).

## Design decisions and why

**An incident can spawn any number of claims — nothing enforces "one
claim per incident."** `Claim.incidentId` is a plain many-to-one, matching
the schema from M2b. A real accident can produce, for example, a separate
own-damage insurance claim and a third-party-recovery claim from the same
incident — collapsing that into one claim record would lose the ability
to track them (and their very different state machines/timelines)
independently.

**Claim write access is `ORG_ADMIN` + `CLAIMS_MANAGER`, org-wide — not
depot-scoped.** Unlike incidents (M6), where `DEPOT_MANAGER` reports and
manages incidents for their own depot, `CLAIMS_MANAGER` is the
purpose-built role for this workflow and needs cross-depot visibility to
do its job (same reasoning `lib/masters/depot-scope.ts` already documents
for master-data reads by non-`DEPOT_MANAGER` roles). `DEPOT_MANAGER` gets
read-only access, still depot-scoped — via the claim's parent `Incident`,
since `Claim` itself has no `depotId` column. Surveys and repair jobs
follow the same shape, with their own purpose-built write roles
(`SURVEYOR`, `WORKSHOP_COORDINATOR` respectively, alongside `ORG_ADMIN` +
`CLAIMS_MANAGER`) — these weren't separately asked about; they're the
direct, low-risk extension of the same pattern to roles the schema
already created for exactly this job.

**BR-05 (policy auto-selection) doesn't block claim creation when no
policy matches.** `selectPolicyForClaim()` queries
`(vehicleId, coverageStartDate, coverageEndDate)` for a window containing
the incident date, same shape the M2b schema doc calls out. If nothing
matches — e.g. the policy hasn't been digitized yet, a real operational
gap — the claim is still created with `policyId: null` rather than
rejected. Blocking claim intake on a data-entry gap elsewhere in the
system would stop staff from doing their job for a reason unrelated to
the claim itself; the missing policy is visible on the claim (`policy:
null`) for someone to fix later.

**The `ClaimStatus` transition map is deliberately explicit, not a free
field.** `CLAIM_TRANSITIONS` in `lib/claims/claim.ts` allows:

```
OPEN → UNDER_SURVEY, REJECTED
UNDER_SURVEY → UNDER_REPAIR, REJECTED
UNDER_REPAIR → PENDING_SETTLEMENT, REJECTED
PENDING_SETTLEMENT → SETTLED, REJECTED
SETTLED → CLOSED
CLOSED, REJECTED → (terminal)
```

Survey and repair-job status each get their own smaller map
(`SURVEY_TRANSITIONS`, `REPAIR_JOB_TRANSITIONS` in their respective
files), the same shape as M6's `transitionIncidentStatus` but generalized
to more than two states since `ClaimStatus`/`SurveyStatus`/
`RepairJobStatus` all have more than OPEN/CLOSED. An invalid transition
throws `DomainError` (409), not a plain 500 — this milestone builds on
M6's `DomainError` fix from the start rather than repeating that bug.

**`SETTLED → CLOSED` has no BR-09 gate yet — this is intentional, not an
oversight.** BR-09 ("a claim cannot be finally closed until
settlement/payment is satisfied") is explicitly M14's job per
`docs/SCOPE.md` and `docs/schema/M2B.md`'s own note ("this is a
business-rule check the domain-settlement service makes at closure time
... the schema doesn't and shouldn't try to encode that logic itself").
`Settlement`/`Payment` recording doesn't exist as a workflow yet, so
there's nothing real to check against. `Claim.closedAt` is still stamped
on the `CLOSED` transition (the column exists for this), so M14 has
something to build the real gate against without a schema change.

**`RepairJob` has no human-readable ID.** Unlike `Incident`/`Claim`/
`Survey`, the M2b schema never gave `RepairJob` a number column — its UUID
`id` is used directly in URLs/API responses. Not something this milestone
should retrofit; flagged here so it's not mistaken for an oversight.

**Workshop activities resolve access through `RepairJob` → `Claim` →
`Incident`, the same non-obvious pattern M6 had to fix for `Evidence`.**
`WorkshopActivity` has no `organizationId` column (confirmed absent from
`ORG_SCOPED_MODELS`), so `addWorkshopActivity()` calls
`assertRepairJobAccessible()` first — which resolves the repair job
through the org-scoped `Claim`/`Incident` chain and checks depot scope —
before creating the activity row directly. Applying the M6 lesson here
from the start avoided repeating that bug rather than finding it again.

## Verification

- **`lib/claims/claim.integration.test.ts`** (9 tests, real Postgres):
  `CLM-YYYY-######` sequential generation; multiple claims against one
  incident; BR-05 auto-selects the policy whose window contains the
  incident date (and ignores a non-covering one for the same vehicle);
  `policyId` stays null (not rejected) with no matching policy, and is
  never looked up for non-INSURANCE/MIXED types; RBAC
  (`CLAIMS_MANAGER`/`ORG_ADMIN` write, `DEPOT_MANAGER`/`SURVEYOR`
  rejected); reassignment + audit; the full `OPEN → ... → CLOSED`
  transition walk with 5 recorded `STATUS_CHANGE` audit entries; invalid
  transitions rejected (409) including out of a terminal state; reads
  depot-scoped for `DEPOT_MANAGER` via the incident, org-wide for
  `CLAIMS_MANAGER`.
- **`lib/claims/survey.integration.test.ts`** (8 tests): `SUR-YYYY-######`
  generation + audit; `SURVEYOR` can write, `DEPOT_MANAGER` cannot, and a
  `DEPOT_MANAGER` from the wrong depot is rejected; findings update +
  audit; the `SCHEDULED → IN_PROGRESS → COMPLETED` walk; rejecting a
  transition out of a terminal status; depot-scoped listing.
- **`lib/claims/repair-job.integration.test.ts`** (9 tests): default INR
  currency + audit; `WORKSHOP_COORDINATOR` can write, `DEPOT_MANAGER`
  cannot; cost-field updates + audit; the
  `ESTIMATE_PENDING → APPROVED → IN_PROGRESS → COMPLETED` walk; rejecting
  a skipped stage (straight to `COMPLETED`); workshop activity logging,
  including a `DEPOT_MANAGER`-from-the-wrong-depot rejection; depot-scoped
  listing.
- **Real HTTP, against the built app**: seeded a city/depot/vehicle and an
  incident via the real API, inserted an `InsurancePolicy` row directly
  (no CRUD API exists for policies yet — out of scope, schema-only since
  M2b) covering the incident date → filed an `INSURANCE` claim → response
  and a follow-up `GET` both showed the auto-selected `policyId` (BR-05,
  confirmed end-to-end) → `OPEN → SETTLED` directly rejected with **409**
  → `OPEN → UNDER_SURVEY` succeeded (200) → scheduled a survey
  (`SUR-2026-000001`) → `SCHEDULED → IN_PROGRESS` (200) → opened a repair
  job → `ESTIMATE_PENDING → COMPLETED` directly rejected with **409** →
  logged a workshop activity (201) → `/claims`, `/claims/[id]`,
  `/claims/new?incidentId=...`, and the incident detail page's new Claims
  section all rendered the real data (200s, correct IDs visible in the
  HTML) → unauthenticated `/api/claims` rejected with **401**.

## Deferred to a follow-up

- **Insurance policy CRUD** — no API/UI exists to create/edit
  `InsurancePolicy` rows yet; they're schema-only since M2b. BR-05
  consumes them but nothing in this system writes them (JBM's policy data
  presumably arrives via document upload/OCR — M11 — or manual entry not
  yet scoped). Flagged, not silently assumed.
- **BR-09's real settlement-closure gate** — M14, as covered above.
- **Settlement/Payment recording** — M14; the schema exists (M2b) but has
  no service layer yet.
- **The TAT engine** (`CaseStageInstance`, hold periods, escalation
  firing) — M8. Nothing in this milestone assumes or blocks it;
  `Claim`/`Incident` are both already valid `CaseStageInstance` subjects
  per the M2b schema.
- **CSV/bulk claim import, a polished claims-intake UI** — same reasoning
  as M4-M6; these demo pages exist to prove the workflow end-to-end, not
  as a finished product.
