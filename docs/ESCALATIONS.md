# Notifications / Escalations — M13

Status: implemented (`lib/escalations/*.ts`, `lib/email/*.ts`,
`app/api/escalation-rules/**`, `app/api/escalations/scan`,
`app/escalation-rules`) · verified via integration tests and real HTTP +
a real worker process against the built app (see "Verification" below).

Covers: PR-03's automatic, configurable escalation hierarchy — a
repeatable reminder scheduler that finds breached TAT stages and fires
each configured `EscalationRule` whose threshold has been crossed, via a
real `EmailProvider` adapter. Building on M8's TAT engine and M9's
breach-detection logic.

## Design decisions and why

**A new table, `EscalationEvent`, tracks what's actually fired — the
first schema migration since M2a/M2b.** M2b's own `EscalationRule`
comment anticipated this exact gap ("actually firing these, and logging
what fired, is M13"). Without it, the scheduler would re-notify the same
level every 15-minute tick forever. `@@unique([caseStageInstanceId,
escalationRuleId])` is the real guarantee against double-firing — checked
before firing (fast path) and relied on as a backstop if two scans
somehow race (caught via its `P2002` conflict, not a lock). Confirmed
with the user before adding it, given how rare a schema change has been
across M3-M11.

**`EmailProvider` follows the exact `OCRProvider` pattern from M11**:
a fixed interface (`docs/SCOPE.md` section 5), resolved via
`EMAIL_PROVIDER` (default `"console"`), a real deterministic stub that
logs rather than sends, and a hard failure for any unrecognized provider
name rather than silently faking delivery. A real SES/SendGrid adapter
is a follow-up once JBM's email sending setup is decided.

**The scheduler is a single system sweep, not per-org jobs.**
`scanAndFireEscalations()` takes an optional `organizationId` — omitted,
it scans every org (what the repeatable worker job does); passed, it
scans just that org (the manual "scan now" endpoint, scoped to the
caller's own org). It runs with no user session at all — this is a
system action, not a user action, so it reads the plain `db` client
directly rather than `scopedDb()`, matching how a cron job legitimately
works outside any one user's request context.

**Breach detection reuses M9's dashboard definition exactly**: only a
still-`IN_PROGRESS` stage whose `dueAt` has passed counts. An `ON_HOLD`
stage never counts, even with a past `dueAt` — its clock is explicitly
paused (PR-02), so escalating it would misattribute a delay to the
handling team while someone else (e.g. the customer) is the actual
blocker. Once resumed, `dueAt` already reflects the hold's extension
(M8), so a genuinely overrun stage still escalates correctly.

**`notifyRole=DEPOT_MANAGER` on an incident-typed stage is confined to
that incident's own depot; every other role/case-type combination is
org-wide.** Matches the depot-scoping precedent from M6-M8 — escalate to
whoever is actually responsible for this specific case, not every depot
manager in the org. Recipients are resolved live at fire time (a query,
not stored) — role membership can change between scans, and an
`EscalationEvent`'s `notifiedEmails` is the permanent record of who was
actually notified at that moment, independent of later role changes.

**A rule with zero resolvable recipients (inactive user, nobody
currently holds the role) is simply retried on the next scan, not
treated as an error or recorded as fired.** If a `DEPOT_MANAGER` is later
hired/activated for that depot, the very next scan picks it up
correctly — no missed notification, no manual intervention needed.

**`EscalationRule.channel` supports EMAIL/WHATSAPP/SMS in the schema,
but only EMAIL is wired to fire.** A WHATSAPP/SMS rule can be created
(the config CRUD doesn't reject it) and simply sits inert — visibly
counted as "skipped" in the scan result, not silently dropped — until
M10's WhatsApp adapter or a future SMS adapter exists. It is also
deliberately **not** recorded in `EscalationEvent`, so it fires
retroactively the moment that channel becomes real, rather than being
permanently marked "already handled" for something that never actually
notified anyone.

**The reminder scheduler runs every 15 minutes** (BullMQ's job-scheduler
API — `Queue.upsertJobScheduler()`, not the older `repeat` option on
`.add()`, which BullMQ 6 removed), plus once immediately on worker boot
so ops don't wait 15 minutes to see the first sweep. A round number for a
TAT measured in hours, not a tuned SLA parameter — revisit if a real need
for finer granularity shows up.

**Escalation-rule configuration is `ORG_ADMIN`-only**, the same tier as
M8's `TatStageTemplate` config it attaches to. The demo form only
exposes `notifyRole` (not `notifyUserId`) — no user-listing endpoint
exists yet to populate a picker from, the same reasoning M7's
claim-assignment form skipped it; the service layer supports both.

## Verification

- **`lib/escalations/escalation-rule.integration.test.ts`** (5 tests,
  real Postgres): `ORG_ADMIN` can create, `CLAIMS_MANAGER` cannot;
  rejects both `notifyRole`+`notifyUserId` set and neither set (on
  create and on update); rejects a duplicate `(stageTemplateId,
  escalationLevel)`; update + audit + ordered listing.
- **`lib/escalations/scan.integration.test.ts`** (7 tests): a
  threshold-crossed rule fires, creates the `EscalationEvent`, calls the
  (spied) email provider with the right recipient, and records a
  `SYSTEM`-channel audit entry; a second scan does not re-fire (checked
  against the actual call count, not just the return value); a rule
  below its threshold doesn't fire; an `ON_HOLD` stage with a past
  `dueAt` is never counted as breached; a `WHATSAPP`-channel rule is
  skipped and not recorded as fired; a `DEPOT_MANAGER`-role rule only
  notifies that incident's own depot's manager, confirmed against a
  second depot's manager who must NOT receive it; scoping to one org
  never fires another org's breach.
- **Real HTTP + a real worker process, against the built app**: created
  a 1-hour-target stage template + a level-1 rule (1h past TAT, notify
  `ORG_ADMIN`) → created an incident (auto-instantiating the stage) →
  pushed its `dueAt` 2 hours into the past directly in Postgres →
  unauthenticated scan rejected (**401**) → `POST
  /api/escalations/scan` (manual trigger) fired exactly once, notified
  `admin@jbm.example`, and the console email provider logged the real
  subject line → re-running the scan fired **zero** new escalations
  (idempotent) → `/escalation-rules` rendered the configured rule →
  created a second incident with a fresh, never-scanned breach → started
  the **real** `workers/index.ts` process (not a direct function call) →
  its boot-time immediate scan independently found and fired the new
  breach, logging the email from the worker's own process — proving the
  repeatable BullMQ scheduler, not just the manually-triggered code path,
  actually works end-to-end.

## Deferred to a follow-up

- **A real email adapter** (SES/SendGrid/...) — `EMAIL_PROVIDER=` once
  JBM's sending setup is decided. The interface is fixed and the console
  stub proves the whole pipeline around it works.
- **WhatsApp/SMS-channel escalation firing** — needs M10's WhatsApp
  adapter (and no SMS adapter is planned yet); rules can be configured
  today and will fire retroactively once those adapters exist.
- **Pre-breach reminders** (a nudge before TAT is even crossed) — nothing
  in the schema (`EscalationRule.triggerAfterHoursBeyondTat` is
  explicitly post-breach) or PR-03 asks for this; not invented ahead of
  a stated need.
- **A configurable scan interval** — hardcoded to 15 minutes; would be a
  one-line change (an env var) if a real need for tuning shows up.
- **A `notifyUserId` picker in the demo UI** — the service layer supports
  it; no user-listing endpoint exists yet to build a picker against.
