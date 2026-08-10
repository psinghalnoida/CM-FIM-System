# Payment & Closure — M14 (settlement model reworked in M19)

Status: implemented (`lib/settlements/*.ts`, `app/api/claims/[id]/settlements/**`,
UI on the standalone Settlement/Payment Detail pages — see
`docs/CLAIM_SUBRECORDS.md`) · verified via integration tests and a real
HTTP walkthrough against the built app (see "Verification" below).

Covers: recording a `Settlement` on a claim and JBM's *response* to it,
recording `Payment`s against an accepted settlement, reconciling payments,
and BR-09 — the financial gate that blocks a claim from reaching `CLOSED`
until its settlement is properly resolved and paid.

## The M19 domain correction — read this first

M14 originally shipped `Settlement.status` as `PENDING → APPROVED/
REJECTED`, modeled as JBM *approving or rejecting* the claim — with an
`approvedById`/`approvedAt` pair recording who decided. That's wrong:
**JBM is the insured, not an approving authority.** The insurer settles
the claim; the surveyor assesses and recommends the loss. JBM has no
claim-approval authority and no monetary approval ceiling exists (or
should ever be added — confirmed explicitly, and deliberately kept out of
`docs/RULES.md`).

M19 reworked the model to record JBM's *response* to the insurer's
settlement offer instead:

```
PENDING → ACCEPTED | DISPUTED | REVIEW_REQUESTED
DISPUTED, REVIEW_REQUESTED → ACCEPTED | DISPUTED | REVIEW_REQUESTED
ACCEPTED → (terminal)
```

`approvedById`/`approvedAt` were renamed to `respondedById`/`respondedAt`
throughout the schema, service layer, and API (`/approve` → `/accept`,
`/reject` → `/dispute`, plus a new `/request-review`). This is a live
schema migration on a real column rename, not just an application-layer
relabeling — see `prisma/migrations/*_m19_settlement_response_repair_parts`.

**Why DISPUTED/REVIEW_REQUESTED aren't terminal, unlike the old REJECTED.**
The pre-M19 model treated a decided settlement as final either way
(`APPROVED` or `REJECTED`, both terminal). That doesn't fit a *response*:
JBM disputing an offer or asking for review is the start of a
back-and-forth with the insurer, not a dead end — the insurer can revise
the offer and JBM can then accept it. Only `ACCEPTED` is terminal, since
that's the trigger for recording real payments against it (this is an
engineering call made while building, not something separately asked
about — flagged here so it reads as a decision, not an oversight).

**BR-09's closure gate now has no excluded/ignorable status.** The old
model let a `REJECTED` settlement skip the gate entirely ("never blocks
closure, even unpaid") because JBM rejecting it meant it would never be
paid. That concept doesn't exist anymore — JBM can't unilaterally take a
settlement off the table. Every settlement on a claim must reach
`ACCEPTED`, fully paid, and fully reconciled before the claim can close.

## Design decisions and why

**Settlement/Payment writes are `ORG_ADMIN` + `FINANCE_OFFICER`, same
role does both.** Confirmed with the user before building — the simplest
split available (no separate "who can respond vs. who can record
payments" distinction), consistent with keeping RBAC coarse-grained
unless a real need for finer separation shows up. Not revisited in M19 —
the correction was about what the status *means*, not who can set it.

**BR-09's closure gate checks every settlement on the claim**, not just
"the latest one" — confirmed with the user in M14, unchanged by M19's
correction. Every settlement must independently reach `ACCEPTED`, fully
paid, and fully reconciled.

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
requires the *sum* of all payments on an `ACCEPTED` settlement to match,
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

- **`lib/settlements/settlement.integration.test.ts`** (11 tests, real
  Postgres): `FINANCE_OFFICER`/`ORG_ADMIN` can create a settlement,
  `CLAIMS_MANAGER` cannot, with an audit entry recorded; `PENDING` →
  `ACCEPTED` records an audit entry and rejects re-deciding an
  already-accepted settlement (**409**, "already been accepted");
  `PENDING` → `DISPUTED` and `PENDING` → `REVIEW_REQUESTED` each work; a
  `DISPUTED` settlement isn't terminal — it can still move to `ACCEPTED`;
  `listSettlementsForClaim`/`getSettlement` include payments; five
  dedicated BR-09 tests exercising `transitionClaimStatus(..., "CLOSED")`
  directly — blocks on a still-`PENDING` settlement, blocks on an
  underpaid `ACCEPTED` settlement, blocks on an unreconciled payment,
  allows closure once fully accepted/paid/reconciled, **a `DISPUTED`
  settlement blocks closure even unpaid** (the corrected behavior — the
  opposite of the old `REJECTED`-exclusion), and a settlement split
  across two payments that together sum correctly still closes.
- **`lib/settlements/payment.integration.test.ts`** (6 tests):
  `createPayment` rejects a `PENDING` (not yet `ACCEPTED`) settlement;
  `FINANCE_OFFICER`/`ORG_ADMIN` can record a payment once accepted,
  `CLAIMS_MANAGER` cannot, with an audit entry; `reconcilePayment` marks
  reconciled, records audit, and rejects reconciling twice (**409**); a
  cross-org reconcile attempt returns **404** and leaves the payment
  genuinely untouched (checked by re-reading it, not just the rejected
  call's return value); `listPaymentsForSettlement` orders by payment
  date.
- **Real HTTP, against the built app** (`next build` + `next start`,
  real Postgres/Redis/S3, M19 walkthrough): created a claim, walked it to
  `SETTLED` → created a ₹42,000 settlement (`PENDING`) → disputed it
  (`DISPUTED`) → **409** closing the claim (message: "is still DISPUTED")
  → accepted it (`ACCEPTED`) → recorded the ₹42,000 payment → reconciled
  it → closed successfully (**200**, `status: "CLOSED"`) → the new
  Settlement/Payment Detail pages both rendered (**200**) with the
  response status and payment correctly. Carried over from M14: a
  `CLAIMS_MANAGER` creating a settlement on another org's claim got
  **403**, and an `ORG_ADMIN` of that second org attempting to reconcile
  the first org's payment by ID got **404** (the cross-org `Payment` bug,
  re-verified still fixed).

## Deferred to a follow-up

- **Partial/overpayment handling beyond "sum must exactly match"** — no
  refund or overpayment workflow exists; BR-09 simply requires an exact
  cents-level match. Revisit if JBM's actual settlement process needs
  over/under adjustments.
- **A settlement-amount edit/void path** — once created, a settlement's
  amount is fixed; only its response status changes. Nothing in
  `docs/RULES.md` currently asks for correction workflows. If the insurer
  revises its offer after a `DISPUTED`/`REVIEW_REQUESTED` response, the
  workflow today is a new `Settlement` record, not editing the amount on
  the existing one — revisit if that turns out to be the wrong shape.
- **Multi-currency settlement/payment reconciliation** — `currency` is
  stored per settlement/payment but never converted or cross-checked; all
  current flows assume a single currency end-to-end (defaults to `INR`).
- **An optional, JBM-supplied internal financial-authority rule** —
  explicitly out of scope unless JBM provides an actual policy; not a
  ₹10L or any other limit, and never added to `docs/RULES.md`
  speculatively (see the M19 domain-correction note above).
