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

// Exported — M24's MIS Reports reuses this exact bucketing for claim
// ageing rather than redefining its own, so the two "how old" concepts
// in this app never drift apart.
export const AGE_BUCKETS = ["0-3", "4-7", "8-14", "15+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function ageBucket(referenceDate: Date, now: Date): AgeBucket {
  const days = Math.floor(
    (now.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

export function emptyBuckets(): Record<AgeBucket, number> {
  return Object.fromEntries(AGE_BUCKETS.map((bucket) => [bucket, 0])) as Record<
    AgeBucket,
    number
  >;
}

const CLAIM_STATUSES = Object.values(ClaimStatus);
const INCIDENT_STATUSES = Object.values(IncidentStatus);

// A claim still counts as "open" for aging purposes until it reaches one
// of its two terminal states — SETTLED is money-resolved but not yet
// formally closed, so it still counts (docs/DASHBOARDS.md). Exported —
// M24's MIS Reports reuses this for the same reason as the bucketing
// functions above.
export const CLAIM_TERMINAL_STATUSES: ClaimStatus[] = [
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

// M21: Corporate Dashboard richness. "Pipeline funnel" isn't a new
// concept — it's the same claimStatusCounts/incidentStatusCounts this
// dashboard already computes, relabeled into the design's six named
// stages (Assessment/Claim/Survey/Repair/Settlement/Payment). This is an
// interpretive mapping, not a literal 1:1 with any stored field — flagged
// in docs/DASHBOARDS.md rather than treated as an exact spec: Assessment
// = still-OPEN incidents (not yet converted to a claim); Payment = claims
// that reached SETTLED (money resolved, awaiting formal CLOSED).
export interface PipelineFunnel {
  assessment: number;
  claim: number;
  survey: number;
  repair: number;
  settlement: number;
  payment: number;
}

export interface DepotPerformance {
  depotId: string;
  depotName: string;
  openIncidents: number;
  openClaims: number;
  breachedStages: number;
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
  pipelineFunnel: PipelineFunnel;
  // Respects the same `depotId` filter as every other section here (M9's
  // "one shared computation, narrowed by the same filter" rule, not a
  // special case) — most useful unfiltered (every depot in the org); a
  // depot-filtered dashboard, or a DEPOT_MANAGER's own fixed scope, both
  // correctly collapse this to a one-row table rather than showing
  // other depots' rows as misleading zeros.
  depotPerformance: DepotPerformance[];
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
    depots,
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
      select: { reportedAt: true, depotId: true },
    }),
    scoped.claim.findMany({
      where: { ...claimWhere, status: { notIn: CLAIM_TERMINAL_STATUSES } },
      select: { openedAt: true, incident: { select: { depotId: true } } },
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
      include: {
        stageTemplate: true,
        incident: true,
        claim: { include: { incident: true } },
      },
      orderBy: { dueAt: "asc" },
    }),
    scoped.depot.findMany({
      where: depotId ? { id: depotId } : undefined,
      select: { id: true, name: true },
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

  const pipelineFunnel: PipelineFunnel = {
    assessment: incidentStatusCounts[IncidentStatus.OPEN],
    claim: claimStatusCounts[ClaimStatus.OPEN],
    survey: claimStatusCounts[ClaimStatus.UNDER_SURVEY],
    repair: claimStatusCounts[ClaimStatus.UNDER_REPAIR],
    settlement: claimStatusCounts[ClaimStatus.PENDING_SETTLEMENT],
    payment: claimStatusCounts[ClaimStatus.SETTLED],
  };

  const depotPerformanceMap = new Map<string, DepotPerformance>(
    depots.map((depot) => [
      depot.id,
      {
        depotId: depot.id,
        depotName: depot.name,
        openIncidents: 0,
        openClaims: 0,
        breachedStages: 0,
      },
    ]),
  );
  for (const incident of openIncidents) {
    const entry = depotPerformanceMap.get(incident.depotId);
    if (entry) entry.openIncidents += 1;
  }
  for (const claim of openClaims) {
    const entry = depotPerformanceMap.get(claim.incident.depotId);
    if (entry) entry.openClaims += 1;
  }
  for (const stage of breachedStages) {
    const stageDepotId =
      stage.incident?.depotId ?? stage.claim?.incident.depotId;
    const entry = stageDepotId
      ? depotPerformanceMap.get(stageDepotId)
      : undefined;
    if (entry) entry.breachedStages += 1;
  }
  const depotPerformance = [...depotPerformanceMap.values()].sort((a, b) =>
    a.depotName.localeCompare(b.depotName),
  );

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
    pipelineFunnel,
    depotPerformance,
  };
}
