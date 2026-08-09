import "server-only";
import { scopedDb } from "@/lib/scoped-db";
import { depotScopeFor } from "@/lib/masters/depot-scope";
import type { AuthSession } from "@/lib/dal";
import {
  ClaimStatus,
  IncidentStatus,
  CaseStageStatus,
} from "@/lib/generated/prisma/enums";

// M9: one shared aggregation, not separate "corporate" and "depot"
// dashboards — a depot filter narrows the exact same computation rather
// than duplicating it. DEPOT_MANAGER's own depot always wins over
// whatever filter.depotId a caller passes (same defense-in-depth as
// depot-scope.ts elsewhere); every other role sees org-wide by default
// and can optionally narrow to one depot. See docs/DASHBOARDS.md.

const AGE_BUCKETS = ["0-3", "4-7", "8-14", "15+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

function ageBucket(referenceDate: Date, now: Date): AgeBucket {
  const days = Math.floor(
    (now.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

function emptyBuckets(): Record<AgeBucket, number> {
  return Object.fromEntries(AGE_BUCKETS.map((bucket) => [bucket, 0])) as Record<
    AgeBucket,
    number
  >;
}

const CLAIM_STATUSES = Object.values(ClaimStatus);
const INCIDENT_STATUSES = Object.values(IncidentStatus);

// A claim still counts as "open" for aging purposes until it reaches one
// of its two terminal states — SETTLED is money-resolved but not yet
// formally closed, so it still counts (docs/DASHBOARDS.md).
const CLAIM_TERMINAL_STATUSES: ClaimStatus[] = [
  ClaimStatus.CLOSED,
  ClaimStatus.REJECTED,
];

export interface BreachedStage {
  stageInstanceId: string;
  caseLabel: string;
  stageName: string;
  dueAt: Date;
  overdueHours: number;
}

export interface OperationalDashboard {
  depotId: string | null;
  incidentStatusCounts: Record<IncidentStatus, number>;
  claimStatusCounts: Record<ClaimStatus, number>;
  aging: {
    incidents: Record<AgeBucket, number>;
    claims: Record<AgeBucket, number>;
  };
  tatBreaches: {
    totalCount: number;
    incidentStageCount: number;
    claimStageCount: number;
    // Most-overdue first, capped — this is a dashboard, not a report
    // export. See docs/DASHBOARDS.md.
    topBreached: BreachedStage[];
  };
}

export interface DashboardFilter {
  depotId?: string;
}

export async function getOperationalDashboard(
  session: AuthSession,
  filter: DashboardFilter = {},
): Promise<OperationalDashboard> {
  const scoped = scopedDb(session.user.organizationId);
  const depotScope = depotScopeFor(session);
  const depotId = depotScope ?? filter.depotId ?? null;
  const now = new Date();

  const incidentWhere = depotId ? { depotId } : {};
  const claimWhere = depotId ? { incident: { depotId } } : {};

  const [
    incidentGroups,
    claimGroups,
    openIncidents,
    openClaims,
    breachedStages,
  ] = await Promise.all([
    scoped.incident.groupBy({
      by: ["status"],
      where: incidentWhere,
      _count: true,
    }),
    scoped.claim.groupBy({
      by: ["status"],
      where: claimWhere,
      _count: true,
    }),
    scoped.incident.findMany({
      where: { ...incidentWhere, status: IncidentStatus.OPEN },
      select: { reportedAt: true },
    }),
    scoped.claim.findMany({
      where: { ...claimWhere, status: { notIn: CLAIM_TERMINAL_STATUSES } },
      select: { openedAt: true },
    }),
    // PR-02: an ON_HOLD stage's clock is paused, so it's deliberately
    // excluded here even if its (pre-hold) dueAt has passed — only an
    // actively-ticking IN_PROGRESS stage counts as breached.
    scoped.caseStageInstance.findMany({
      where: {
        status: CaseStageStatus.IN_PROGRESS,
        dueAt: { lt: now },
        ...(depotId
          ? {
              OR: [
                { incident: { depotId } },
                { claim: { incident: { depotId } } },
              ],
            }
          : {}),
      },
      include: { stageTemplate: true, incident: true, claim: true },
      orderBy: { dueAt: "asc" },
    }),
  ]);

  const incidentStatusCounts = Object.fromEntries(
    INCIDENT_STATUSES.map((status) => [status, 0]),
  ) as Record<IncidentStatus, number>;
  for (const group of incidentGroups) {
    incidentStatusCounts[group.status] = group._count;
  }

  const claimStatusCounts = Object.fromEntries(
    CLAIM_STATUSES.map((status) => [status, 0]),
  ) as Record<ClaimStatus, number>;
  for (const group of claimGroups) {
    claimStatusCounts[group.status] = group._count;
  }

  const incidentAging = emptyBuckets();
  for (const incident of openIncidents) {
    incidentAging[ageBucket(incident.reportedAt, now)] += 1;
  }
  const claimAging = emptyBuckets();
  for (const claim of openClaims) {
    claimAging[ageBucket(claim.openedAt, now)] += 1;
  }

  const topBreached: BreachedStage[] = breachedStages
    .slice(0, 10)
    .map((stage) => ({
      stageInstanceId: stage.id,
      caseLabel: stage.incident
        ? stage.incident.incidentNumber
        : stage.claim!.claimNumber,
      stageName: stage.stageTemplate.stageName,
      dueAt: stage.dueAt!,
      overdueHours: (now.getTime() - stage.dueAt!.getTime()) / 3_600_000,
    }));

  return {
    depotId,
    incidentStatusCounts,
    claimStatusCounts,
    aging: { incidents: incidentAging, claims: claimAging },
    tatBreaches: {
      totalCount: breachedStages.length,
      incidentStageCount: breachedStages.filter((s) => s.incidentId).length,
      claimStageCount: breachedStages.filter((s) => s.claimId).length,
      topBreached,
    },
  };
}
