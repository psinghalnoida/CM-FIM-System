import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope } from "@/lib/masters/depot-scope";
import { DomainError } from "@/lib/domain-error";
import { RepairJobStatus } from "@/lib/generated/prisma/enums";

// Workshop/repair tracking, a sub-workflow of a Claim (docs/schema/M2B.md).
// Which workshop is a Workshop master-data row (M27,
// lib/masters/workshop.ts) — was free text on RepairJob directly before
// that, see docs/MASTERS.md's M27 section for the backfill. RepairJob
// has no human-readable ID (unlike Incident/Claim/Survey) since the
// schema doesn't define one; its UUID is used directly. See
// docs/CLAIMS.md.

const WRITE_ROLES = [
  "ORG_ADMIN",
  "CLAIMS_MANAGER",
  "WORKSHOP_COORDINATOR",
] as const;

export const REPAIR_JOB_TRANSITIONS: Record<
  RepairJobStatus,
  RepairJobStatus[]
> = {
  ESTIMATE_PENDING: ["APPROVED", "CANCELLED"],
  APPROVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Resolves a claim through the org-scoped client and checks depot scope via its parent incident. */
async function assertClaimAccessible(session: AuthSession, claimId: string) {
  const scoped = scopedDb(session.user.organizationId);
  const claim = await scoped.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: { incident: true },
  });
  assertDepotInScope(session, claim.incident.depotId);
  return claim;
}

async function assertRepairJobAccessible(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  const repairJob = await scoped.repairJob.findUniqueOrThrow({
    where: { id },
    include: { claim: { include: { incident: true } } },
  });
  assertDepotInScope(session, repairJob.claim.incident.depotId);
  return repairJob;
}

export const CreateRepairJobSchema = z.object({
  claimId: z.uuid(),
  workshopId: z.uuid(),
  estimatedCost: z.number().positive().optional(),
  currency: z.string().trim().length(3).optional(),
  startDate: z.coerce.date().optional(),
});
export type CreateRepairJobInput = z.infer<typeof CreateRepairJobSchema>;

export async function createRepairJob(session: AuthSession, input: unknown) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateRepairJobSchema.parse(input);
  await assertClaimAccessible(session, data.claimId);

  const scoped = scopedDb(session.user.organizationId);
  await scoped.workshop.findUniqueOrThrow({ where: { id: data.workshopId } });

  const repairJob = await db.repairJob.create({
    data: {
      organizationId: session.user.organizationId,
      claimId: data.claimId,
      workshopId: data.workshopId,
      estimatedCost: data.estimatedCost,
      currency: data.currency ?? "INR",
      startDate: data.startDate,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "RepairJob",
    entityId: repairJob.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: repairJob,
    sourceChannel: "WEB",
  });

  return repairJob;
}

export const UpdateRepairJobSchema = z.object({
  estimatedCost: z.number().positive().optional(),
  approvedCost: z.number().positive().optional(),
  actualCost: z.number().positive().optional(),
  endDate: z.coerce.date().optional(),
});
export type UpdateRepairJobInput = z.infer<typeof UpdateRepairJobSchema>;

export async function updateRepairJob(
  session: AuthSession,
  id: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateRepairJobSchema.parse(input);
  const before = await assertRepairJobAccessible(session, id);

  const scoped = scopedDb(session.user.organizationId);
  const repairJob = await scoped.repairJob.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "RepairJob",
    entityId: repairJob.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: repairJob,
    sourceChannel: "WEB",
  });

  return repairJob;
}

export async function transitionRepairJobStatus(
  session: AuthSession,
  id: string,
  to: RepairJobStatus,
) {
  requireRole(session, ...WRITE_ROLES);
  const before = await assertRepairJobAccessible(session, id);

  const allowed = REPAIR_JOB_TRANSITIONS[before.status];
  if (!allowed.includes(to)) {
    throw new DomainError(
      `Cannot transition a repair job from ${before.status} to ${to}.`,
      409,
    );
  }

  const scoped = scopedDb(session.user.organizationId);
  const repairJob = await scoped.repairJob.update({
    where: { id },
    data: { status: to },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "RepairJob",
    entityId: repairJob.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: repairJob.status },
    sourceChannel: "WEB",
  });

  return repairJob;
}

export const AddWorkshopActivitySchema = z.object({
  activityType: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(2000).optional(),
});
export type AddWorkshopActivityInput = z.infer<
  typeof AddWorkshopActivitySchema
>;

export async function addWorkshopActivity(
  session: AuthSession,
  repairJobId: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = AddWorkshopActivitySchema.parse(input);
  await assertRepairJobAccessible(session, repairJobId);

  const activity = await db.workshopActivity.create({
    data: {
      repairJobId,
      activityType: data.activityType,
      notes: data.notes,
      actorId: session.user.id,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "WorkshopActivity",
    entityId: activity.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: activity,
    sourceChannel: "WEB",
  });

  return activity;
}

// M19: a named-parts list for the Repair Detail page's "Parts" tab — see
// prisma/schema.prisma's RepairPart comment for why this isn't a
// parts-catalog/inventory model.
export const AddRepairPartSchema = z.object({
  partName: z.string().trim().min(1).max(200),
});
export type AddRepairPartInput = z.infer<typeof AddRepairPartSchema>;

export async function addRepairPart(
  session: AuthSession,
  repairJobId: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = AddRepairPartSchema.parse(input);
  await assertRepairJobAccessible(session, repairJobId);

  const part = await db.repairPart.create({
    data: { repairJobId, partName: data.partName },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "RepairPart",
    entityId: part.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: part,
    sourceChannel: "WEB",
  });

  return part;
}

export async function listRepairPartsForRepairJob(
  session: AuthSession,
  repairJobId: string,
) {
  await assertRepairJobAccessible(session, repairJobId);
  return db.repairPart.findMany({
    where: { repairJobId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getRepairJob(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  const repairJob = await scoped.repairJob.findUnique({
    where: { id },
    include: {
      claim: { include: { incident: true } },
      workshop: true,
      activities: { orderBy: { occurredAt: "desc" } },
      parts: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!repairJob) return null;
  assertDepotInScope(session, repairJob.claim.incident.depotId);
  return repairJob;
}

export async function listRepairJobsForClaim(
  session: AuthSession,
  claimId: string,
) {
  await assertClaimAccessible(session, claimId);
  const scoped = scopedDb(session.user.organizationId);
  return scoped.repairJob.findMany({
    where: { claimId },
    include: { workshop: true },
    orderBy: { createdAt: "desc" },
  });
}
