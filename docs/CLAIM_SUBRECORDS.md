# Claim Sub-Record Detail Pages — M19

Status: implemented (`app/(app)/claims/[id]/surveys/[surveyId]`,
`app/(app)/claims/[id]/repair-jobs/[repairJobId]`,
`app/(app)/claims/[id]/settlements/[settlementId]`,
`app/(app)/claims/[id]/settlements/[settlementId]/payments/[paymentId]`) ·
verified via integration tests and a real HTTP walkthrough against the
built app (see "Verification" below).

Covers: Survey, Repair job, Settlement, and Payment each become
standalone, tabbed detail pages — matching the Claims Mitra design —
replacing the inline tables/inline actions Claim Detail previously held
for all four. Claim Detail now links out to each record instead. The
settlement domain correction (JBM's response, not an approval decision)
is covered separately in `docs/PAYMENTS.md`; this doc covers the page
structure and the new supporting data these tabs needed.

## Design decisions and why

**Tabs are server-rendered via a `?tab=` search param, not client
state.** Every other page in this app is a server component; a tab
switcher needing client JS and `useState` would be the odd one out for
no real benefit — plain `<Link href="?tab=X">`s re-render the page
server-side, same cost as any other navigation. `components/shared/
detail-tabs.tsx` is the one shared component all four pages use.

**Full design tab sets were built, not just the tabs backed by
pre-existing data — an explicit scope call, not a default.** The design's
`SURVEY_TAB_DEFS`/`REPAIR_TAB_DEFS`/`SETTLEMENT_TAB_DEFS`/
`PAYMENT_TAB_DEFS` include tabs needing data this system didn't have
before M19 (Survey's Observations, Repair's Parts/Invoices, Settlement's
Letter). Asked explicitly rather than trimmed by default; the answer was
to build the missing pieces now:

- **Survey → Observations**: reuses `Survey.findings` (already existed
  since M7, just had no UI to edit it) — no schema change.
- **Repair → Parts**: a new `RepairPart` model (`id`, `repairJobId`,
  `partName`, `createdAt`) — a simple named-parts list, matching the
  design exactly (no cost/qty tracking asked for, so none was added).
- **Repair → Invoices**, **Settlement → Letter**: both reuse the existing
  M5 document-repository upload flow (presign → PUT → complete),
  extended to link to `REPAIR_JOB`/`SETTLEMENT` — see
  `docs/DOCUMENTS.md`'s M19 update and "Document linking" below.
- **Repair → Progress**: reuses `WorkshopActivity` (existed since M7,
  also had no UI before this) — a real activity log
  (`ESTIMATE_SUBMITTED`/`PARTS_ORDERED`/`QC_CHECK`/`HANDOVER`/`OTHER`),
  not the design's static placeholder sentence. Richer and just as real
  as what the design mocked, so it was used instead of inventing text.
- **Every "Timeline" tab**: reuses `AuditLog` directly via a new
  `listAuditLogForEntity()` helper in `lib/audit.ts` — no new event-log
  model, same approach `docs/SCOPE.md` already flags for M20's Claim-level
  Audit tab.

**Payment is its own standalone page, not a sub-section of Settlement.**
The design's `PAYMENT_TAB_DEFS` is a separate tab set from
`SETTLEMENT_TAB_DEFS`, and the schema models `Payment` as a real 1:N
child of `Settlement` (a settlement can be split across multiple
payments, `docs/PAYMENTS.md`) — so the Settlement Detail page lists its
payments and links to each one's own detail page, rather than trying to
flatten them into Settlement's tabs. This is a closer fit to the actual
data model than the design's flatter single-settlement assumption, which
was built against mock data with one of each per incident.

## Document linking extended to CLAIM/SURVEY/REPAIR_JOB/SETTLEMENT

`lib/documents/link-scope.ts`'s own code comment predicted this exact
follow-up since M5: "CLAIM/SURVEY/REPAIR_JOB (M7+) will each need a case
added here once their owning module exists." M19 is that follow-up, plus
`SETTLEMENT` (added to `LinkedEntityType` in this migration).

**Write RBAC per entity type mirrors that entity's own module**, not the
`VEHICLE`/`DRIVER` `ORG_ADMIN`+`DEPOT_MANAGER` default:

| Linked entity | Who can upload | Matches |
|---|---|---|
| `CLAIM` | `ORG_ADMIN`, `CLAIMS_MANAGER` | `lib/claims/claim.ts` |
| `SURVEY` | `ORG_ADMIN`, `CLAIMS_MANAGER`, `SURVEYOR` | `lib/claims/survey.ts` |
| `REPAIR_JOB` | `ORG_ADMIN`, `CLAIMS_MANAGER`, `WORKSHOP_COORDINATOR` | `lib/claims/repair-job.ts` |
| `SETTLEMENT` | `ORG_ADMIN`, `FINANCE_OFFICER` | `lib/settlements/settlement.ts` |

A `SURVEYOR` uploading a survey report makes sense; a `SURVEYOR`
uploading a repair invoice doesn't — reusing the module's own write role
list, rather than one shared default, keeps that distinction real instead
of accidental.

**Depot resolution walks the claim relation chain.** None of these four
entity types have their own `depotId` column — a sub-record's depot is
its parent claim's incident's depot. `resolveDepotId()` now has a case
for each, all one or two hops to `claim.incident.depotId`. A
`DEPOT_MANAGER` outside that depot is rejected reading or writing a
linked document, the same guarantee `VEHICLE`/`DRIVER` already had.

## Verification

- **`lib/claims/repair-job.integration.test.ts`** (+2 tests):
  `addRepairPart`/`listRepairPartsForRepairJob` returns parts in creation
  order, also present on `getRepairJob`'s `parts` include; a
  `DEPOT_MANAGER` from a different depot is rejected adding a part.
- **`lib/documents/document.integration.test.ts`** (+4 tests, real
  s3rver): a full presign → PUT → complete round trip for `SURVEY`,
  `REPAIR_JOB`, and `SETTLEMENT` each — verifying the right role can
  upload and the wrong role (e.g. `WORKSHOP_COORDINATOR` for a survey
  report) is rejected; a `DEPOT_MANAGER` outside the claim's incident
  depot cannot read a linked survey document.
- **Real HTTP, against the built app**: walked a claim through `SETTLED`,
  exercised the full settlement response cycle (dispute → blocks closure
  → accept → payment → reconcile → closes; see `docs/PAYMENTS.md`'s
  verification), and confirmed the Settlement Detail and Payment Detail
  pages both render (**200**) with real data. Seeded and built
  successfully with the reworked service layer (`prisma/seed.ts` calling
  `acceptSettlement`), confirming the demo dataset still constructs
  end-to-end under the new model.

## Deferred to a follow-up

- **A parts cost/quantity model** — the design's Parts tab is a plain
  name list; nothing asked for per-part cost or quantity tracking, so
  none was added. Revisit if JBM's actual repair-estimate process needs
  it.
- **Editing/deleting a logged part or workshop activity** — both are
  append-only for now, matching how `WorkshopActivity` already worked
  before this milestone.
- **A richer document-viewer experience on the Report/Invoices/Letter
  tabs** — reuses M5's bare upload-form-plus-list UI verbatim; the
  Document Viewer restyle (confidence bar, Verify/Flag actions) is M22's
  job per `docs/SCOPE.md`.
