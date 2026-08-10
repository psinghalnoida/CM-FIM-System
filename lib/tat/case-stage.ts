import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope } from "@/lib/masters/depot-scope";
import { DomainError } from "@/lib/domain-error";
import {
  CaseStageStatus,
  ResponsibleParty,
} from "@/lib/generated/prisma/enums";
import type { CaseType } from "@/lib/generated/prisma/enums";

// PR-01/PR-02/PR-03: real per-case TAT tracking against the
// TatStageTemplate configuration (lib/tat/stage-template.ts). See
// docs/TAT.md for the full design (why stages auto-instantiate
// sequentially, how hold periods extend dueAt, and what's still manual).

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Called from inside createIncident()/createClaim()'s own transaction —
 * never opens its own. Creates one PENDING CaseStageInstance per active
 * TatStageTemplate configured for this org/case type, ordered by
 * sequenceOrder; the first one starts IN_PROGRESS immediately with its
 * TAT clock running (dueAt = now + targetHours). No templates configured
 * for this org/case type yet is not an error — nothing to instantiate.
 */
export async function instantiateStagesForCase(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  organizationId: string,
  caseType: CaseType,
  subject: { incidentId: string } | { claimId: string },
): Promise<void> {
  const templates = await tx.tatStageTemplate.findMany({
    where: { organizationId, caseType, isActive: true },
    orderBy: { sequenceOrder: "asc" },
  });
  if (templates.length === 0) return;

  const now = new Date();
  for (const [index, template] of templates.entries()) {
    const isFirst = index === 0;
    await tx.caseStageInstance.create({
      data: {
        organizationId,
        ...subject,
        stageTemplateId: template.id,
        status: isFirst ? CaseStageStatus.IN_PROGRESS : CaseStageStatus.PENDING,
        enteredAt: now,
        dueAt: isFirst ? addHours(now, template.targetHours) : null,
      },
    });
  }
}

/** Loads a stage instance through the org-scoped client, with what's needed to check depot scope and drive the domain logic. */
async function loadStageInstance(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  return scoped.caseStageInstance.findUniqueOrThrow({
    where: { id },
    include: {
      stageTemplate: true,
      holdPeriods: true,
      incident: true,
      claim: { include: { incident: true } },
    },
  });
}

type LoadedStageInstance = Awaited<ReturnType<typeof loadStageInstance>>;

function subjectDepotId(instance: LoadedStageInstance): string {
  // The DB CHECK constraint (docs/schema/M2B.md) guarantees exactly one
  // of these is set; the `?? forbidden` path below is unreachable in
  // practice and exists only to satisfy TypeScript.
  if (instance.incident) return instance.incident.depotId;
  if (instance.claim) return instance.claim.incident.depotId;
  throw new Error(
    "CaseStageInstance has neither an incident nor a claim — a schema invariant was violated.",
  );
}

/**
 * Write access to a stage instance mirrors whatever governs its subject:
 * incident-typed stages use M6's incident RBAC (ORG_ADMIN + depot-scoped
 * DEPOT_MANAGER); claim-typed stages use M7's claim RBAC (ORG_ADMIN +
 * org-wide CLAIMS_MANAGER). No new stage-specific role — TAT actions are
 * just another thing the people who already own the case do.
 */
function assertCanManageStage(
  session: AuthSession,
  instance: LoadedStageInstance,
): void {
  if (instance.incidentId) {
    requireRole(session, "ORG_ADMIN", "DEPOT_MANAGER");
  } else {
    requireRole(session, "ORG_ADMIN", "CLAIMS_MANAGER");
  }
  assertDepotInScope(session, subjectDepotId(instance));
}

export interface ElapsedTimeSummary {
  targetHours: number;
  elapsedHours: number;
  heldHours: number;
  netHours: number;
  breached: boolean;
}

/**
 * PR-02: TAT-elapsed calculations exclude held time. Wall-clock elapsed
 * since enteredAt, minus the sum of every hold period's duration (an
 * open hold counts up to now), compared against the stage's target.
 * Meaningless for a still-PENDING stage (enteredAt isn't real yet) — 0s
 * are returned rather than throwing, since "not started" isn't an error.
 */
export function computeElapsedTime(
  instance: LoadedStageInstance,
): ElapsedTimeSummary {
  const targetHours = instance.stageTemplate.targetHours;
  if (instance.status === CaseStageStatus.PENDING) {
    return {
      targetHours,
      elapsedHours: 0,
      heldHours: 0,
      netHours: 0,
      breached: false,
    };
  }

  const end = instance.completedAt ?? new Date();
  const elapsedMs = end.getTime() - instance.enteredAt.getTime();
  const heldMs = instance.holdPeriods.reduce((sum, hold) => {
    const holdEnd = hold.endedAt ?? new Date();
    return sum + (holdEnd.getTime() - hold.startedAt.getTime());
  }, 0);
  const netMs = Math.max(0, elapsedMs - heldMs);

  const elapsedHours = elapsedMs / 3_600_000;
  const heldHours = heldMs / 3_600_000;
  const netHours = netMs / 3_600_000;

  return {
    targetHours,
    elapsedHours,
    heldHours,
    netHours,
    breached: netHours > targetHours,
  };
}

export async function getStageInstance(session: AuthSession, id: string) {
  const instance = await loadStageInstance(session, id);
  assertDepotInScope(session, subjectDepotId(instance));
  return { ...instance, elapsed: computeElapsedTime(instance) };
}

export interface ListStageInstancesFilter {
  incidentId?: string;
  claimId?: string;
}

export async function listStageInstancesForCase(
  session: AuthSession,
  filter: ListStageInstancesFilter,
) {
  if (!filter.incidentId && !filter.claimId) {
    throw new DomainError("incidentId or claimId is required.", 400);
  }
  const scoped = scopedDb(session.user.organizationId);
  const instances = await scoped.caseStageInstance.findMany({
    where: {
      incidentId: filter.incidentId,
      claimId: filter.claimId,
    },
    include: {
      stageTemplate: true,
      holdPeriods: true,
      incident: true,
      claim: { include: { incident: true } },
    },
    orderBy: { stageTemplate: { sequenceOrder: "asc" } },
  });
  instances.forEach((instance) =>
    assertDepotInScope(session, subjectDepotId(instance)),
  );
  return instances.map((instance) => ({
    ...instance,
    elapsed: computeElapsedTime(instance),
  }));
}

/**
 * Completes the stage and — the point of "sequential, one active stage
 * at a time" (docs/TAT.md) — automatically starts the next PENDING stage
 * for the same case, if one exists. Without this, "sequential" would
 * mean two manual actions (complete this, then remember to start that)
 * for every step.
 */
export async function completeStage(session: AuthSession, id: string) {
  const before = await loadStageInstance(session, id);
  assertCanManageStage(session, before);

  if (before.status !== CaseStageStatus.IN_PROGRESS) {
    throw new DomainError(
      before.status === CaseStageStatus.ON_HOLD
        ? "End the active hold before completing this stage."
        : `Cannot complete a stage that is ${before.status}.`,
      409,
    );
  }

  const subjectWhere = before.incidentId
    ? { incidentId: before.incidentId }
    : { claimId: before.claimId! };

  const stage = await db.$transaction(async (tx) => {
    const completed = await tx.caseStageInstance.update({
      where: { id },
      data: { status: CaseStageStatus.COMPLETED, completedAt: new Date() },
    });

    const nextPending = await tx.caseStageInstance.findFirst({
      where: { ...subjectWhere, status: CaseStageStatus.PENDING },
      include: { stageTemplate: true },
      orderBy: { stageTemplate: { sequenceOrder: "asc" } },
    });
    if (nextPending) {
      const now = new Date();
      await tx.caseStageInstance.update({
        where: { id: nextPending.id },
        data: {
          status: CaseStageStatus.IN_PROGRESS,
          enteredAt: now,
          dueAt: addHours(now, nextPending.stageTemplate.targetHours),
        },
      });
    }
    return completed;
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "CaseStageInstance",
    entityId: stage.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: stage.status },
    sourceChannel: "WEB",
  });

  return stage;
}

export const StartHoldSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  responsibleParty: z.enum(ResponsibleParty),
});
export type StartHoldInput = z.infer<typeof StartHoldSchema>;

export async function startHold(
  session: AuthSession,
  stageInstanceId: string,
  input: unknown,
) {
  const data = StartHoldSchema.parse(input);
  const before = await loadStageInstance(session, stageInstanceId);
  assertCanManageStage(session, before);

  if (before.status !== CaseStageStatus.IN_PROGRESS) {
    throw new DomainError(
      `Cannot place a hold on a stage that is ${before.status}.`,
      409,
    );
  }

  const [, hold] = await db.$transaction([
    db.caseStageInstance.update({
      where: { id: stageInstanceId },
      data: { status: CaseStageStatus.ON_HOLD },
    }),
    db.tatHoldPeriod.create({
      data: {
        caseStageInstanceId: stageInstanceId,
        reason: data.reason,
        responsibleParty: data.responsibleParty,
        createdById: session.user.id,
      },
    }),
  ]);

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "TatHoldPeriod",
    entityId: hold.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: hold,
    sourceChannel: "WEB",
  });

  return hold;
}

/**
 * Ends the stage's open hold period and extends dueAt by exactly the
 * hold's duration — the schema comment's "recomputed whenever a hold
 * period ends" (docs/schema/M2B.md). This is what makes dueAt a fast,
 * self-contained "is this breached" check without re-summing hold
 * periods elsewhere; computeElapsedTime() above independently sums them
 * too, for reporting the actual elapsed/held/net breakdown.
 */
export async function endHold(session: AuthSession, stageInstanceId: string) {
  const before = await loadStageInstance(session, stageInstanceId);
  assertCanManageStage(session, before);

  if (before.status !== CaseStageStatus.ON_HOLD) {
    throw new DomainError(`Stage ${stageInstanceId} is not on hold.`, 409);
  }
  const openHold = before.holdPeriods.find((h) => h.endedAt === null);
  if (!openHold) {
    throw new Error(
      "Stage is ON_HOLD but has no open TatHoldPeriod — a data invariant was violated.",
    );
  }

  const now = new Date();
  const holdDurationMs = now.getTime() - openHold.startedAt.getTime();

  const [, , stage] = await db.$transaction([
    db.tatHoldPeriod.update({
      where: { id: openHold.id },
      data: { endedAt: now },
    }),
    db.caseStageInstance.update({
      where: { id: stageInstanceId },
      data: {
        status: CaseStageStatus.IN_PROGRESS,
        dueAt: before.dueAt
          ? new Date(before.dueAt.getTime() + holdDurationMs)
          : undefined,
      },
    }),
    db.caseStageInstance.findUniqueOrThrow({ where: { id: stageInstanceId } }),
  ]);

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "TatHoldPeriod",
    entityId: openHold.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: { endedAt: null },
    afterData: { endedAt: now },
    sourceChannel: "WEB",
  });

  return stage;
}
