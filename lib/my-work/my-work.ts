import "server-only";
import { scopedDb } from "@/lib/scoped-db";
import { depotScopeFor } from "@/lib/masters/depot-scope";
import type { AuthSession } from "@/lib/dal";
import { getTatDashboard } from "@/lib/tat/dashboard";
import { CLAIM_TERMINAL_STATUSES } from "@/lib/dashboards/operational-dashboard";
import {
  IncidentStatus,
  SurveyStatus,
  RepairJobStatus,
  SettlementStatus,
} from "@/lib/generated/prisma/enums";

// M26: My Work — a personalized "needs your action" view, scoped to the
// caller's role. No new schema, no new "assigned to me" concept: nothing
// in this app tracks per-user assignment except Survey.surveyorUserId
// (nullable, set only when the surveyor is an internal user), and even
// that isn't who's *allowed* to act (any SURVEYOR can update any
// survey — see lib/claims/survey.ts's WRITE_ROLES). So "needs your
// action" here means "what your role's WRITE_ROLES already let you
// touch, and hasn't reached a terminal state yet" — the same RBAC/
// terminal-status definitions each module already uses, not a new
// notion invented for this page. AUDITOR is read-only everywhere
// (docs/schema/M2A.md) and gets an empty, explicit "nothing to action"
// result rather than an invented list. See docs/DASHBOARDS.md's M26
// section.

export type MyWorkItemKind =
  | "INCIDENT"
  | "CLAIM"
  | "SURVEY"
  | "REPAIR_JOB"
  | "SETTLEMENT"
  | "PAYMENT"
  | "TAT_STAGE";

export interface MyWorkItem {
  kind: MyWorkItemKind;
  id: string;
  label: string;
  detail: string;
  href: string;
}

export interface MyWork {
  role: string;
  items: MyWorkItem[];
}

async function openIncidentItems(
  session: AuthSession,
  depotId: string | null,
): Promise<MyWorkItem[]> {
  const scoped = scopedDb(session.user.organizationId);
  const incidents = await scoped.incident.findMany({
    where: { status: IncidentStatus.OPEN, ...(depotId ? { depotId } : {}) },
    select: { id: true, incidentNumber: true, incidentType: true },
    orderBy: { incidentNumber: "asc" },
  });
  return incidents.map((incident) => ({
    kind: "INCIDENT",
    id: incident.id,
    label: incident.incidentNumber,
    detail: incident.incidentType.replaceAll("_", " "),
    href: `/incidents/${incident.id}`,
  }));
}

async function openClaimItems(session: AuthSession): Promise<MyWorkItem[]> {
  const scoped = scopedDb(session.user.organizationId);
  const claims = await scoped.claim.findMany({
    where: { status: { notIn: CLAIM_TERMINAL_STATUSES } },
    select: { id: true, claimNumber: true, status: true },
    orderBy: { claimNumber: "asc" },
  });
  return claims.map((claim) => ({
    kind: "CLAIM",
    id: claim.id,
    label: claim.claimNumber,
    detail: claim.status.replaceAll("_", " "),
    href: `/claims/${claim.id}`,
  }));
}

async function openSurveyItems(session: AuthSession): Promise<MyWorkItem[]> {
  const scoped = scopedDb(session.user.organizationId);
  const surveys = await scoped.survey.findMany({
    where: { status: { in: [SurveyStatus.SCHEDULED, SurveyStatus.IN_PROGRESS] } },
    select: {
      id: true,
      surveyNumber: true,
      status: true,
      claimId: true,
    },
    orderBy: { surveyNumber: "asc" },
  });
  return surveys.map((survey) => ({
    kind: "SURVEY",
    id: survey.id,
    label: survey.surveyNumber,
    detail: survey.status,
    href: `/claims/${survey.claimId}/surveys/${survey.id}`,
  }));
}

const REPAIR_JOB_OPEN_STATUSES = [
  RepairJobStatus.ESTIMATE_PENDING,
  RepairJobStatus.APPROVED,
  RepairJobStatus.IN_PROGRESS,
];

async function openRepairJobItems(
  session: AuthSession,
): Promise<MyWorkItem[]> {
  const scoped = scopedDb(session.user.organizationId);
  const jobs = await scoped.repairJob.findMany({
    where: { status: { in: REPAIR_JOB_OPEN_STATUSES } },
    select: {
      id: true,
      workshopName: true,
      status: true,
      claimId: true,
      claim: { select: { claimNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return jobs.map((job) => ({
    kind: "REPAIR_JOB",
    id: job.id,
    label: `${job.claim.claimNumber} — ${job.workshopName}`,
    detail: job.status.replaceAll("_", " "),
    href: `/claims/${job.claimId}/repair-jobs/${job.id}`,
  }));
}

const SETTLEMENT_OPEN_STATUSES = [
  SettlementStatus.PENDING,
  SettlementStatus.DISPUTED,
  SettlementStatus.REVIEW_REQUESTED,
];

async function openSettlementItems(
  session: AuthSession,
): Promise<MyWorkItem[]> {
  const scoped = scopedDb(session.user.organizationId);
  const settlements = await scoped.settlement.findMany({
    where: { status: { in: SETTLEMENT_OPEN_STATUSES } },
    select: {
      id: true,
      settlementAmount: true,
      status: true,
      claimId: true,
      claim: { select: { claimNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return settlements.map((s) => ({
    kind: "SETTLEMENT",
    id: s.id,
    label: `${s.claim.claimNumber} — ${s.settlementAmount}`,
    detail: s.status.replaceAll("_", " "),
    href: `/claims/${s.claimId}/settlements/${s.id}`,
  }));
}

async function unreconciledPaymentItems(
  session: AuthSession,
): Promise<MyWorkItem[]> {
  const scoped = scopedDb(session.user.organizationId);
  const payments = await scoped.payment.findMany({
    where: { reconciled: false },
    select: {
      id: true,
      amount: true,
      settlementId: true,
      settlement: { select: { claimId: true, claim: { select: { claimNumber: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return payments.map((p) => ({
    kind: "PAYMENT",
    id: p.id,
    label: `${p.settlement.claim.claimNumber} — ${p.amount}`,
    detail: "Unreconciled",
    href: `/claims/${p.settlement.claimId}/settlements/${p.settlementId}/payments/${p.id}`,
  }));
}

async function tatStageItems(
  session: AuthSession,
  subject: "INCIDENT" | "CLAIM" | "BOTH",
): Promise<MyWorkItem[]> {
  const dashboard = await getTatDashboard(session);
  return dashboard.rows
    .filter((row) => {
      if (subject === "BOTH") return true;
      const isIncident = row.caseType === "INCIDENT";
      return subject === "INCIDENT" ? isIncident : !isIncident;
    })
    .map((row) => ({
      kind: "TAT_STAGE" as const,
      id: row.stageInstanceId,
      label: `${row.caseLabel} — ${row.stageName}`,
      detail: row.elapsed.breached ? "Breached" : row.status.replaceAll("_", " "),
      href:
        row.caseType === "INCIDENT"
          ? `/incidents/${row.caseId}`
          : `/claims/${row.caseId}`,
    }));
}

export async function getMyWork(session: AuthSession): Promise<MyWork> {
  const role = session.user.role;
  const depotScope = depotScopeFor(session);

  switch (role) {
    case "ORG_ADMIN": {
      const [incidents, claims, surveys, repairJobs, settlements, payments, stages] =
        await Promise.all([
          openIncidentItems(session, null),
          openClaimItems(session),
          openSurveyItems(session),
          openRepairJobItems(session),
          openSettlementItems(session),
          unreconciledPaymentItems(session),
          tatStageItems(session, "BOTH"),
        ]);
      return {
        role,
        items: [
          ...incidents,
          ...claims,
          ...surveys,
          ...repairJobs,
          ...settlements,
          ...payments,
          ...stages,
        ],
      };
    }
    case "DEPOT_MANAGER": {
      const [incidents, stages] = await Promise.all([
        openIncidentItems(session, depotScope),
        tatStageItems(session, "INCIDENT"),
      ]);
      return { role, items: [...incidents, ...stages] };
    }
    case "CLAIMS_MANAGER": {
      const [claims, stages] = await Promise.all([
        openClaimItems(session),
        tatStageItems(session, "CLAIM"),
      ]);
      return { role, items: [...claims, ...stages] };
    }
    case "SURVEYOR": {
      const surveys = await openSurveyItems(session);
      return { role, items: surveys };
    }
    case "WORKSHOP_COORDINATOR": {
      const repairJobs = await openRepairJobItems(session);
      return { role, items: repairJobs };
    }
    case "FINANCE_OFFICER": {
      const [settlements, payments] = await Promise.all([
        openSettlementItems(session),
        unreconciledPaymentItems(session),
      ]);
      return { role, items: [...settlements, ...payments] };
    }
    default:
      // AUDITOR (read-only everywhere) and the system principals
      // (SUPER_ADMIN, WHATSAPP_BOT) have no "needs your action" queue —
      // an honest empty result, not an invented one.
      return { role, items: [] };
  }
}
