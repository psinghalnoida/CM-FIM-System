# Payment & Closure — M14

Status: implemented (`lib/settlements/*.ts`, `app/api/claims/[id]/settlements/**`,
UI wired into `app/claims/[id]/page.tsx`) · verified via integration tests
and a real HTTP walkthrough against the built app (see "Verification"
below).

Covers: recording and approving/rejecting a `Settlement` on a claim,
recording `Payment`s against an approved settlement, reconciling payments,
and BR-09 — the financial gate that blocks a claim from reaching `CLOSED`
until its settlement is properly resolved and paid.

## Design decisions and why

**Settlement/Payment writes are `ORG_ADMIN` + `FINANCE_OFFICER`, same
role does both.** Confirmed with the user before building — the simplest
split available (no separate "who can approve vs. who can record
payments" distinction), consistent with keeping RBAC coarse-grained
unless a real need for finer separation shows up.

**BR-09's closure gate checks every non-`REJECTED` settlement on the
claim**, not just "the latest one" — also confirmed with the user. A
`REJECTED` settlement never blocks closure, even if it was never paid;
every other settlement (`PENDING` or `APPROVED`) must be `APPROVED` with
its payments fully summed and fully reconciled.

**A claim with zero settlements ever recorded is not blocked from
closing — flagged, not silently assumed.** `docs/SCOPE.md`'s M2b note
("the latest settlement is APPROVED...") doesn't say what happens when no
settlement exists at all (e.g. a `MAINTENANCE` claim, which has no
financial settlement path at all per the claim-type model). Rather than
invent a rule, `assertClaimSettlementSatisfied` treats an empty
settlement list as trivially satisfied (loop over zero settlements never
throws). This was checked against the pre-existing M7 test that closes a
`MAINTENANCE` claim with zero settlements — it still passes unchanged, so
this reading doesn't regress any established behavior. If JBM's actual
process requires at least one settlement before `INSURANCE`/`ACCIDENT`
claims can close, that's a follow-up rule, not something to guess at now.

**Money comparison uses whole cents (`Math.round(amount * 100)`), not a
decimal library.** Prisma's `Decimal(14,2)` columns already round to two
places at the DB level; converting to an integer cents count before
comparing sums avoids floating-point drift (e.g. `0.1 + 0.2 !== 0.3`)
without pulling in arbitrary-precision arithmetic for a comparison this
simple. Not a general-purpose money type — just enough for "do these
payments sum to the settlement amount."

**A settlement can be split across multiple payments.** BR-09 doesn't
require a single payment to equal the full settlement amount — it
requires the *sum* of all payments on an `APPROVED` settlement to match,
and *all* of those payments to be individually reconciled. Verified with
a two-payment split in both the integration tests and the HTTP
walkthrough.

**A real bug found and fixed while building this (before any test or
HTTP exposure)**: `Payment` has no `organizationId` column in the schema
— identical to `Evidence` (M6) and `WorkshopActivity` (M7). The first
draft of `reconcilePayment` fetched the `Payment` row via `scopedDb()`
first, which does **not** filter models absent from `ORG_SCOPED_MODELS`
— meaning any authenticated user, from any org, could reconcile another
org's payment just by guessing/enumerating its UUID. Fixed by fetching
via the plain `db` client with a `settlement` include and an explicit
`before.settlement.organizationId !== session.user.organizationId` check
→ `DomainError` **404** (not 403 — deliberately doesn't confirm the
payment exists at all), mirroring M6's `getEvidenceDownloadUrl()` fix
exactly. Re-verified live over real HTTP with a genuine second
organization (see "Verification").

## Verification

- **`lib/settlements/settlement.integration.test.ts`** (9 tests, real
  Postgres): `FINANCE_OFFICER`/`ORG_ADMIN` can create a settlement,
  `CLAIMS_MANAGER` cannot, with an audit entry recorded; `PENDING` →
  `APPROVED`/`REJECTED` transitions record audit entries and reject
  re-deciding an already-decided settlement (**409**);
  `listSettlementsForClaim`/`getSettlement` include payments; six
  dedicated BR-09 tests exercising `transitionClaimStatus(..., "CLOSED")`
  directly — blocks on a still-`PENDING` settlement, blocks on an
  underpaid `APPROVED` settlement, blocks on an unreconciled payment,
  allows closure once fully approved/paid/reconciled, a `REJECTED`
  settlement never blocks even unpaid, and a settlement split across two
  payments that together sum correctly still closes.
- **`lib/settlements/payment.integration.test.ts`** (6 tests):
  `createPayment` rejects a `PENDING` (not yet `APPROVED`) settlement;
  `FINANCE_OFFICER`/`ORG_ADMIN` can record a payment once approved,
  `CLAIMS_MANAGER` cannot, with an audit entry; `reconcilePayment` marks
  reconciled, records audit, and rejects reconciling twice (**409**); a
  cross-org reconcile attempt returns **404** and leaves the payment
  genuinely untouched (checked by re-reading it, not just the rejected
  call's return value); `listPaymentsForSettlement` orders by payment
  date.
- **Real HTTP, against the built app** (`next build` + `next start`,
  real Postgres/Redis/S3): created a claim, walked it to `SETTLED` →
  created a ₹10,000 settlement → **409** closing while it was still
  `PENDING` → approved it → recorded a ₹4,000 payment → **409** closing
  while underpaid → recorded the remaining ₹6,000 payment → **409**
  closing while both payments were unreconciled → reconciled both
  (second reconcile-attempt on the first payment correctly **409**s) →
  closed successfully (**200**, `status: "CLOSED"`) → the claim detail
  page rendered the settlement amount, both payments, and both
  `reconciled: Yes` flags correctly (`Decimal` → `.toString()` fix
  confirmed live, not just in a unit test). Also confirmed with a genuine
  second organization: a `CLAIMS_MANAGER` creating a settlement on
  another org's claim got **403**, and an `ORG_ADMIN` of that second org
  attempting to reconcile the first org's payment by ID got **404** (the
  bug above, re-verified as fixed over real HTTP, not just in-process).

## Deferred to a follow-up

- **Partial/overpayment handling beyond "sum must exactly match"** — no
  refund or overpayment workflow exists; BR-09 simply requires an exact
  cents-level match. Revisit if JBM's actual settlement process needs
  over/under adjustments.
- **A settlement-amount edit/void path** — once created, a settlement's
  amount is fixed; only its status (`APPROVED`/`REJECTED`) changes.
  Nothing in `docs/RULES.md` currently asks for correction workflows.
- **Multi-currency settlement/payment reconciliation** — `currency` is
  stored per settlement/payment but never converted or cross-checked; all
  current flows assume a single currency end-to-end (defaults to `INR`).
