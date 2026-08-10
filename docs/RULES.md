# CM FIM System — Business Rules & Process Rules

Status: **Active** · This is the canonical reference for *why* the system
behaves the way it does. Every rule below has an ID, a definition, and a
reason — if a design decision seems arbitrary later, check here first; if
it isn't here, it isn't a settled rule yet and should be asked about rather
than assumed.

Scope of this document: **foundational, cross-cutting rules** that apply
system-wide, drawn directly from the development brief. Module-specific
rules (e.g. exact claim-type state transitions, survey-specific TAT stages)
will be added here incrementally as each module is scoped, per
[`docs/SCOPE.md`](SCOPE.md) — not all at once.

Ground rule for this project: **no implementation proceeds without the
relevant rule(s) being written here first, and no change to a rule happens
without telling the owner.** When in doubt, ask — do not assume or overbuild.

---

## Business Rules
*(what must always be true about the data/entities, regardless of which screen or channel touched them)*

**BR-01 — Incident Is the Parent Record**
Definition: Every fleet incident is logged exactly once as an `incident` record. All downstream activity — documents, evidence, telematics, survey, repair, claims, settlement — attaches to that one `incident_id` and is never re-created under a separate root record.
Reason: Prevents fragmented, duplicate histories of the same real-world event; guarantees one source of truth for lifecycle tracking, reporting, and audit.

**BR-02 — No Duplicate Data Entry From Incident to Claim**
Definition: When a claim is created from an incident, every field already captured on the incident (vehicle, driver, date/time, location, description, evidence, documents) is carried forward by reference, not re-typed or re-uploaded.
Reason: Re-entry is a source of transcription errors and wasted effort, and it breaks the single-source-of-truth guarantee in BR-01.

**BR-03 — Multiple Claims May Attach to One Incident**
Definition: An incident may give rise to more than one claim (e.g. an insurance claim and a third-party recovery claim from the same accident), each with its own type, lifecycle, and TAT tracking.
Reason: Real fleet incidents often trigger more than one financial/administrative process; forcing 1:1 would either lose information or force artificial duplicate incidents.

**BR-04 — Documents Must Be Versioned**
Definition: A document is never overwritten in place. Each upload creates a new `document_version`; the document record always points at its current version, and prior versions remain retrievable.
Reason: Insurance/claims documents (RC, policy schedule, repair estimate) get corrected or reissued over a claim's life; versioning preserves what was known/submitted at each point in time, which audit and dispute resolution both depend on.

**BR-05 — Policy Applicable on Incident Date Is Auto-Selected**
Definition: When a claim is created, the system automatically identifies the insurance policy whose coverage period contains the incident date for that vehicle, rather than requiring manual policy lookup.
Reason: Manual selection risks the wrong policy period being applied (e.g. after a renewal), which can misdirect or invalidate a claim; the incident date is an unambiguous, already-captured fact to key off.

**BR-06 — Telematics Snapshot Is Captured Once and Is Permanent**
Definition: Telematics data (speed, location, harsh-braking events, etc.) is pulled at incident-report time and stored as an immutable `telematics_snapshot`. It is never refreshed, recalculated, or replaced afterward.
Reason: The evidentiary value of telematics data is what the vehicle was doing at the time of the incident — a live/refreshable feed would let the "evidence" drift and undermine its use in claims and disputes.

**BR-07 — OCR Never Silently Overwrites Master Data**
Definition: Fields extracted by OCR from a document are stored as proposed values pending human verification. They only update master data (vehicle, driver, policy, etc.) after an authorized user explicitly reviews and confirms them.
Reason: OCR is probabilistic and can misread digits, dates, or names; letting it write master data unattended risks silently corrupting records that claims, TAT, and payments all depend on.

**BR-08 — Every Important User Action Creates an Audit Record**
Definition: Any action that creates, changes state, or modifies data on an incident, claim, document, or financial record writes an audit log entry capturing who, what, when, before/after values, and source channel.
Reason: Insurance and financial processes are subject to internal and regulatory scrutiny; a complete audit trail is the only way to reconstruct and defend what happened on a case.

**BR-09 — A Claim Cannot Be Finally Closed Without Settlement/Payment**
Definition: The claim-closure action is blocked by the system until settlement and payment/reconciliation requirements defined for that claim type are satisfied.
Reason: Prevents claims being marked "done" administratively while money is still outstanding, which is the single most common source of financial leakage in claims processes.

**BR-10 — JBM's FMS Is the Operational Source of Truth for Telemetry**
Definition: CM FIM System does not attempt to replace or mirror JBM's Fleet Management System as the live operational telemetry system. It stores only the incident-relevant snapshot (BR-06), not an ongoing telemetry stream.
Reason: Keeps this system's scope bounded to incident/claim management (per the architectural brief — modular monolith, not a telematics platform) and avoids two systems disagreeing about live vehicle state.

---

## Process Rules
*(how a workflow/procedure must behave as it runs)*

**PR-01 — Every Workflow Stage Has a Configurable TAT**
Definition: Each stage of an incident/claim/survey/repair workflow has a turnaround-time target that is configured per organization and case type (not hard-coded), and stage entry/exit timestamps are tracked against it.
Reason: Different claim types and organizations need different SLAs (e.g. warranty vs. insurance TAT differs); hard-coding would require a code change for every business policy tweak.

**PR-02 — TAT Supports On-Hold Periods With Reason and Responsible Party**
Definition: A stage's TAT clock can be paused by recording a hold period with a reason and the party responsible for the delay (e.g. "awaiting driver statement — Depot"). TAT-elapsed calculations exclude held time.
Reason: Stages are often blocked waiting on someone outside the handling team's control; without holds, TAT reporting would unfairly penalize (or mask the real cause of) delays that aren't the assignee's fault.

**PR-03 — Escalations Are Automatic and Configurable**
Definition: When a stage's TAT (excluding hold time, per PR-02) is breached, the system automatically notifies a configurable escalation hierarchy — it does not rely on someone noticing and escalating manually.
Reason: Manual escalation is the first thing that lapses under workload pressure, which is exactly when escalation matters most; automation makes the SLA enforcement real rather than aspirational.

**PR-04 — WhatsApp Is an Incident-Entry Channel Only**
Definition: The WhatsApp Business API integration is scoped to reporting/creating incidents (and receiving basic status updates). It is not a channel for managing claims, surveys, repairs, or approvals — that happens in the main application.
Reason: Keeps a channel with no reliable audit/permission model out of the actual case-management workflow, while still making it easy for drivers/depot staff to report an incident from a phone.

**PR-05 — External Integrations Use an Adapter/Interface, Not a Direct Dependency**
Definition: Telematics, OCR, WhatsApp, and email integrations are each defined as an interface that domain code depends on; a concrete provider (JBM telematics, AWS Textract, Meta Cloud API, SMTP/SES) is plugged in via configuration, not imported directly into business logic.
Reason: Providers change (new telematics platform, different OCR vendor) and Phase 1 doesn't even have JBM's telematics API yet — the adapter boundary lets that be swapped later without touching claim/incident/TAT logic.

---

## Change log

| Date | Change |
|---|---|
| 2026-08-08 | Initial version — 10 Business Rules, 5 Process Rules, drawn from the Phase 1 development brief. |
