import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope, depotScopeFor } from "@/lib/masters/depot-scope";
import { DriverStatus } from "@/lib/generated/prisma/enums";

const licenseNumber = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((s) => s.toUpperCase());

export const CreateDriverSchema = z.object({
  depotId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  licenseNumber,
  licenseExpiryDate: z.coerce.date().optional(),
  phone: z.string().trim().max(20).optional(),
});
export type CreateDriverInput = z.infer<typeof CreateDriverSchema>;

export const UpdateDriverSchema = CreateDriverSchema.partial().extend({
  status: z.enum(DriverStatus).optional(),
});
export type UpdateDriverInput = z.infer<typeof UpdateDriverSchema>;

const WRITE_ROLES = ["ORG_ADMIN", "DEPOT_MANAGER"] as const;

/** DEPOT_MANAGER only sees drivers at their own depot; other roles see the whole org. */
export async function listDrivers(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  const scope = depotScopeFor(session);
  return db.driver.findMany({
    where: scope ? { depotId: scope } : undefined,
    orderBy: { name: "asc" },
  });
}

export async function getDriver(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  const driver = await db.driver.findUnique({ where: { id } });
  if (driver) assertDepotInScope(session, driver.depotId);
  return driver;
}

export async function createDriver(
  session: AuthSession,
  input: CreateDriverInput,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateDriverSchema.parse(input);
  assertDepotInScope(session, data.depotId);
  const db = scopedDb(session.user.organizationId);

  const driver = await db.driver.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Driver",
    entityId: driver.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: driver,
    sourceChannel: "WEB",
  });

  return driver;
}

export async function updateDriver(
  session: AuthSession,
  id: string,
  input: UpdateDriverInput,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateDriverSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const before = await db.driver.findUniqueOrThrow({ where: { id } });
  assertDepotInScope(session, before.depotId);
  // Transferring a driver to a different depot is ORG_ADMIN-only, same
  // reasoning as vehicle transfers — see lib/masters/vehicle.ts.
  if (data.depotId && data.depotId !== before.depotId) {
    requireRole(session, "ORG_ADMIN");
  }

  const driver = await db.driver.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Driver",
    entityId: driver.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: driver,
    sourceChannel: "WEB",
  });

  return driver;
}

/** Soft-delete: master data referenced elsewhere (incidents, ...) is never hard-deleted. */
export async function archiveDriver(session: AuthSession, id: string) {
  requireRole(session, ...WRITE_ROLES);
  const db = scopedDb(session.user.organizationId);

  const before = await db.driver.findUniqueOrThrow({ where: { id } });
  assertDepotInScope(session, before.depotId);

  const driver = await db.driver.update({
    where: { id },
    data: { status: "INACTIVE" },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Driver",
    entityId: driver.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: driver.status },
    sourceChannel: "WEB",
  });

  return driver;
}
