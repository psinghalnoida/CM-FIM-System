import "server-only";
import { scopedDb } from "@/lib/scoped-db";
import { depotScopeFor } from "@/lib/masters/depot-scope";
import type { AuthSession } from "@/lib/dal";
import { computeElapsedTime } from "@/lib/tat/case-stage";
import {
  AGE_BUCKETS,
  ageBucket,
  emptyBuckets,
  CLAIM_TERMINAL_STATUSES,
  type AgeBucket,
} from "@/lib/dashboards/operational-dashboard";
import { CaseStageStatus, IncidentType } from "@/lib/generated/prisma/enums";

// M24: MIS Reports — claim ageing, TAT compliance %, incident-type
// frequency, and repair turnaround by depot. Four new aggregation
// queries against existing data (Claim/CaseStageInstance/Incident/
// RepairJob) — no new models, no new stored metrics. Claim ageing reuses
// M9's exact bucket definition (lib/dashboards/operational-dashboard.ts)
// rather than a second, possibly-drifting one. See docs/DASHBOARDS.md's
// M24 section.

const INCIDENT_TYPES = Object.values(IncidentType);

export interface TatComplianceSummary {
  totalCompletedStages: number;
  compliantStages: number;
  // null (not 0) when there's nothing completed yet to measure — "no
  // data" and "0% compliant" are different facts, same reasoning as
  // M22's averageOcrConfidence.
  compliancePercent: number | null;
}

export interface RepairTurnaroundRow {
  depotId: string;
  depotName: string;
  completedJobCount: number;
  avgTurnaroundDays: number | null;
}

export interface MisReport {
  depotId: string | null;
  claimAgeing: Record<AgeBucket, number>;
  tatCompliance: TatComplianceSummary;
  incidentTypeFrequency: Record<IncidentType, number>;
  repairTurnaroundByDepot: RepairTurnaroundRow[];
}

export interface MisReportFilter {
  depotId?: string;
}

export async function getMisReport(
  session: AuthSession,
  filter: MisReportFilter = {},
): Promise<MisReport> {
  const scoped = scopedDb(session.user.organizationId);
  const depotScope = depotScopeFor(session);
  if (depotScope && filter.depotId && filter.depotId !== depotScope) {
    return emptyReport(depotScope);
  }
  const depotId = depotScope ?? filter.depotId ?? null;
  const now = new Date();

  const incidentWhere = depotId ? { depotId } : {};
  const claimWhere = depotId ? { incident: { depotId } } : {};
  const stageDepotWhere = depotId
    ? {
        OR: [{ incident: { depotId } }, { claim: { incident: { depotId } } }],
      }
    : {};

  const [openClaims, completedStages, incidentGroups, repairJobs, depots] =
    await Promise.all([
      scoped.claim.findMany({
        where: { ...claimWhere, status: { notIn: CLAIM_TERMINAL_STATUSES } },
        select: { openedAt: true },
      }),
      scoped.caseStageInstance.findMany({
        where: { status: CaseStageStatus.COMPLETED, ...stageDepotWhere },
        include: { stageTemplate: true, holdPeriods: true },
      }),
      scoped.incident.groupBy({
        by: ["incidentType"],
        where: incidentWhere,
        _count: true,
      }),
      scoped.repairJob.findMany({
        where: {
          startDate: { not: null },
          endDate: { not: null },
          claim: claimWhere,
        },
        select: {
          startDate: true,
          endDate: true,
          claim: { select: { incident: { select: { depotId: true } } } },
        },
      }),
      scoped.depot.findMany({
        where: depotId ? { id: depotId } : undefined,
        select: { id: true, name: true },
      }),
    ]);

  const claimAgeing = emptyBuckets();
  for (const claim of openClaims) {
    claimAgeing[ageBucket(claim.openedAt, now)] += 1;
  }

  let compliantStages = 0;
  for (const stage of completedStages) {
    if (!computeElapsedTime(stage).breached) compliantStages += 1;
  }
  const tatCompliance: TatComplianceSummary = {
    totalCompletedStages: completedStages.length,
    compliantStages,
    compliancePercent:
      completedStages.length === 0
        ? null
        : Math.round((compliantStages / completedStages.length) * 100),
  };

  const incidentTypeFrequency = Object.fromEntries(
    INCIDENT_TYPES.map((type) => [type, 0]),
  ) as Record<IncidentType, number>;
  for (const group of incidentGroups) {
    incidentTypeFrequency[group.incidentType] = group._count;
  }

  const turnaroundMap = new Map<
    string,
    { depotName: string; totalDays: number; count: number }
  >(depots.map((d) => [d.id, { depotName: d.name, totalDays: 0, count: 0 }]));
  for (const job of repairJobs) {
    const jobDepotId = job.claim.incident.depotId;
    const entry = turnaroundMap.get(jobDepotId);
    if (!entry) continue;
    const days =
      (job.endDate!.getTime() - job.startDate!.getTime()) / 86_400_000;
    entry.totalDays += days;
    entry.count += 1;
  }
  const repairTurnaroundByDepot: RepairTurnaroundRow[] = [
    ...turnaroundMap.entries(),
  ]
    .map(([id, entry]) => ({
      depotId: id,
      depotName: entry.depotName,
      completedJobCount: entry.count,
      avgTurnaroundDays:
        entry.count === 0
          ? null
          : Math.round((entry.totalDays / entry.count) * 10) / 10,
    }))
    .sort((a, b) => a.depotName.localeCompare(b.depotName));

  return {
    depotId,
    claimAgeing,
    tatCompliance,
    incidentTypeFrequency,
    repairTurnaroundByDepot,
  };
}

function emptyReport(depotId: string | null): MisReport {
  return {
    depotId,
    claimAgeing: emptyBuckets(),
    tatCompliance: {
      totalCompletedStages: 0,
      compliantStages: 0,
      compliancePercent: null,
    },
    incidentTypeFrequency: Object.fromEntries(
      INCIDENT_TYPES.map((type) => [type, 0]),
    ) as Record<IncidentType, number>,
    repairTurnaroundByDepot: [],
  };
}

// Re-exported for pages/tests that only need the bucket labels, not the
// whole operational-dashboard module.
export { AGE_BUCKETS };
