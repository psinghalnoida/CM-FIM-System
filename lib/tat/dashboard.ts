import "server-only";
import { scopedDb } from "@/lib/scoped-db";
import { depotScopeFor } from "@/lib/masters/depot-scope";
import type { AuthSession } from "@/lib/dal";
import { CaseStageStatus, CaseType } from "@/lib/generated/prisma/enums";
import { computeElapsedTime, type ElapsedTimeSummary } from "@/lib/tat/case-stage";

// M23: TAT Dashboard — a live board of every in-progress case's TAT
// status, across incidents and claims. "In-progress" here means a stage
// that has actually started and hasn't finished: IN_PROGRESS or ON_HOLD.
// PENDING stages haven't started their clock yet (nothing to show) and
// COMPLETED ones are done — this is a live board, not a report of
// history (that's M24's job). New aggregation over M8's
// CaseStageInstance, reusing case-stage.ts's own computeElapsedTime — no
// new models, no new math. See docs/TAT.md.

const ACTIVE_STATUSES: CaseStageStatus[] = [
  CaseStageStatus.IN_PROGRESS,
  CaseStageStatus.ON_HOLD,
];

export interface TatDashboardRow {
  stageInstanceId: string;
  caseType: CaseType;
  caseId: string;
  caseLabel: string;
  depotId: string;
  depotName: string;
  stageName: string;
  status: CaseStageStatus;
  dueAt: Date | null;
  elapsed: ElapsedTimeSummary;
}

export interface TatDashboardSummary {
  totalActive: number;
  inProgress: number;
  onHold: number;
  breached: number;
}

export interface TatDashboard {
  depotId: string | null;
  summary: TatDashboardSummary;
  rows: TatDashboardRow[];
}

export interface TatDashboardFilter {
  depotId?: string;
  caseType?: CaseType;
  breachedOnly?: boolean;
}

/** DEPOT_MANAGER only sees stages whose case is at their own depot; an out-of-scope depotId filter returns an empty board rather than a bypass or a confusing empty result via query collision — the same call made throughout this codebase (e.g. M21's listIncidents). */
export async function getTatDashboard(
  session: AuthSession,
  filter: TatDashboardFilter = {},
): Promise<TatDashboard> {
  const scoped = scopedDb(session.user.organizationId);
  const depotScope = depotScopeFor(session);
  if (depotScope && filter.depotId && filter.depotId !== depotScope) {
    return { depotId: depotScope, summary: emptySummary(), rows: [] };
  }
  const depotId = depotScope ?? filter.depotId ?? null;

  const instances = await scoped.caseStageInstance.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      ...(filter.caseType ? { stageTemplate: { caseType: filter.caseType } } : {}),
      ...(depotId
        ? {
            OR: [
              { incident: { depotId } },
              { claim: { incident: { depotId } } },
            ],
          }
        : {}),
    },
    include: {
      stageTemplate: true,
      holdPeriods: true,
      incident: { include: { depot: true } },
      claim: { include: { incident: { include: { depot: true } } } },
    },
    orderBy: { dueAt: "asc" },
  });

  const rows: TatDashboardRow[] = instances.map((instance) => {
    const depot = instance.incident?.depot ?? instance.claim!.incident.depot;
    return {
      stageInstanceId: instance.id,
      caseType: instance.stageTemplate.caseType,
      caseId: instance.incidentId ?? instance.claimId!,
      caseLabel: instance.incident
        ? instance.incident.incidentNumber
        : instance.claim!.claimNumber,
      depotId: depot.id,
      depotName: depot.name,
      stageName: instance.stageTemplate.stageName,
      status: instance.status,
      dueAt: instance.dueAt,
      elapsed: computeElapsedTime(instance),
    };
  });

  const filtered = filter.breachedOnly
    ? rows.filter((row) => row.elapsed.breached)
    : rows;

  const summary: TatDashboardSummary = {
    totalActive: rows.length,
    inProgress: rows.filter((r) => r.status === CaseStageStatus.IN_PROGRESS)
      .length,
    onHold: rows.filter((r) => r.status === CaseStageStatus.ON_HOLD).length,
    breached: rows.filter((r) => r.elapsed.breached).length,
  };

  return { depotId, summary, rows: filtered };
}

function emptySummary(): TatDashboardSummary {
  return { totalActive: 0, inProgress: 0, onHold: 0, breached: 0 };
}
