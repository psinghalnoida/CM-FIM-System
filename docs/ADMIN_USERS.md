# Administration: Users — M18

Status: implemented (`lib/admin/user.ts`, `app/api/admin/users/**`,
`app/(app)/admin/users/page.tsx`) · verified via integration tests and a
real HTTP walkthrough against the built app (see "Verification" below).

Covers: the first real way to create, list, and manage a user other than
direct database access (previously only `prisma/seed.ts` or manual SQL).
Closes a gap several earlier milestones' own comments flagged — M13's
escalation-rule form, for one, explicitly noted "no user-listing endpoint
exists yet" as the reason `notifyUserId` wasn't exposed in its UI.

## Design decisions and why

**ORG_ADMIN only.** Same tier as every other Administration-level config
in this system — `TatStageTemplate` (M8), `EscalationRule` (M13). User
management is at least as sensitive as either of those.

**SUPER_ADMIN and WHATSAPP_BOT are not assignable through this UI.**
`docs/SCOPE.md`'s own RBAC list describes `SUPER_ADMIN` as "cross-org,
support only" — a platform-level role, not something an org's own admin
should be able to grant. `WHATSAPP_BOT` is "a system principal for
inbound-message-created incidents," not a person. `ASSIGNABLE_ROLES` in
`lib/admin/user.ts` is the full `UserRole` enum minus those two.

**No invite-email flow — the admin sets an initial password directly.**
`EmailProvider` (M13) is console-only; there's no real sending
configured yet to build a "send a password-setup link" flow against.
The admin sets a password at creation time, the same approach
`prisma/seed.ts` already uses. Self-service reset is a real follow-up
once `EMAIL_PROVIDER` points at something real.

**`passwordHash` is stripped before anything leaves the service layer** —
every returned user object, and every `beforeData`/`afterData` passed to
`recordAudit()`. Checked explicitly in both the integration tests and
the HTTP walkthrough (`grep`'d the actual response and audit-log JSON
for the string, not just trusted the code path), since `recordAudit()`
stores whatever JSON it's handed verbatim — passing a raw `User` row in
would have written the bcrypt hash straight into `audit_logs`.

**A DEPOT_MANAGER must have a `depotId` — enforced on both create and
update.** `lib/masters/depot-scope.ts`'s `depotScopeFor()` already
`forbidden()`s a `DEPOT_MANAGER` session with no `depotId` on their very
first request; this validates the precondition at creation time instead
of letting an admin create a broken account that locks itself out
immediately. Reassigning an existing user *to* `DEPOT_MANAGER` without
also supplying a `depotId` in the same request is rejected the same way.

**An admin cannot deactivate their own account.** The one universal
guard in `updateUser`, regardless of which other field is changing —
prevents an org's only admin from locking themselves out. Deactivating
*someone else* still works normally.

**Deactivation is immediately effective, not just a block on future
logins.** `getActiveDbSession()` (M3) already checks
`session.user.status !== "ACTIVE"` on every request — so setting a
user's status to `INACTIVE` invalidates every session they currently
hold, not just new ones. No separate bulk session-revocation code was
needed; this was verified live, not assumed — see "Verification".

**No separate deactivate/reactivate routes.** `deactivateUser()` is a
thin service-layer wrapper (mirroring `lib/masters/driver.ts`'s
`archiveDriver()`) but the API surface is just `PATCH
/api/admin/users/{id}` with `{status: "..."}` — reactivation is the same
endpoint, not a separate one.

## Verification

- **`lib/admin/user.integration.test.ts`** (9 tests, real Postgres):
  `ORG_ADMIN` can create a user and neither the response nor the audit
  entry contain `passwordHash`; `CLAIMS_MANAGER` cannot create a user;
  creating a `DEPOT_MANAGER` without a `depotId` is rejected, with one
  is accepted; deactivate → `STATUS_CHANGE` audit entry → reactivate
  round-trips; an admin cannot deactivate themselves; role reassignment
  works; reassigning to `DEPOT_MANAGER` without a `depotId` is rejected;
  `listUsers`/`getUser` never include `passwordHash`.
- **Real HTTP, against the built app**: `CLAIMS_MANAGER` listing users —
  **403**; `ORG_ADMIN` creating a `FINANCE_OFFICER` — **201**, response
  grepped for the literal string `passwordHash` and confirmed absent;
  creating a `DEPOT_MANAGER` with no `depotId` — **400** with the Zod
  message, then the same request with a `depotId` — **201**; the admin
  attempting to deactivate their own account — **409**; deactivating
  another user — **200**; listing users afterward — response grepped
  clean of `passwordHash` again; unauthenticated request — **401**; and
  the session-invalidation property specifically — minted a **brand
  new, unexpired, unrevoked** session for the now-deactivated user and
  confirmed a request with it still gets **401**, proving deactivation
  itself (not session expiry/revocation) is what's being checked.

## Deferred to a follow-up

- **Self-service password reset / invite-by-email** — needs a real
  `EmailProvider` adapter (M13's `docs/ESCALATIONS.md` follow-up list)
  before there's anything to send a link through.
- **A `notifyUserId` picker in M13's escalation-rule form** — this
  milestone is exactly the missing piece that comment was waiting on;
  wiring it up is a small follow-up to M13's own code, not done here to
  keep this milestone's diff scoped to Administration: Users itself.
- **Bulk import / CSV user provisioning** — not asked for; one-at-a-time
  creation is what's built.
