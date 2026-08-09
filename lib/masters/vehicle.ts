import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope, depotScopeFor } from "@/lib/masters/depot-scope";
import { VehicleType, VehicleStatus } from "@/lib/generated/prisma/enums";

const registrationNumber = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .transform((s) => s.toUpperCase());

export const CreateVehicleSchema = z.object({
  depotId: z.uuid(),
  registrationNumber,
  chassisNumber: z.string().trim().max(60).optional(),
  engineNumber: z.string().trim().max(60).optional(),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  vehicleType: z.enum(VehicleType).optional(),
  manufactureYear: z
    .number()
    .int()
    .min(1980)
    .max(new Date().getFullYear() + 1)
    .optional(),
  registrationDate: z.coerce.date().optional(),
});
export type CreateVehicleInput = z.infer<typeof CreateVehicleSchema>;

export const UpdateVehicleSchema = CreateVehicleSchema.partial().extend({
  status: z.enum(VehicleStatus).optional(),
});
export type UpdateVehicleInput = z.infer<typeof UpdateVehicleSchema>;

const WRITE_ROLES = ["ORG_ADMIN", "DEPOT_MANAGER"] as const;

/** DEPOT_MANAGER only sees vehicles at their own depot; other roles see the whole org. */
export async function listVehicles(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  const scope = depotScopeFor(session);
  return db.vehicle.findMany({
    where: scope ? { depotId: scope } : undefined,
    orderBy: { registrationNumber: "asc" },
  });
}

export async function getVehicle(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  const vehicle = await db.vehicle.findUnique({ where: { id } });
  if (vehicle) assertDepotInScope(session, vehicle.depotId);
  return vehicle;
}

export async function createVehicle(
  session: AuthSession,
  input: CreateVehicleInput,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateVehicleSchema.parse(input);
  assertDepotInScope(session, data.depotId);
  const db = scopedDb(session.user.organizationId);

  const vehicle = await db.vehicle.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Vehicle",
    entityId: vehicle.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: vehicle,
    sourceChannel: "WEB",
  });

  return vehicle;
}

export async function updateVehicle(
  session: AuthSession,
  id: string,
  input: UpdateVehicleInput,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateVehicleSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const before = await db.vehicle.findUniqueOrThrow({ where: { id } });
  // A DEPOT_MANAGER may only touch a vehicle already in their own depot...
  assertDepotInScope(session, before.depotId);
  // ...and moving it to a *different* depot (a transfer) is ORG_ADMIN-only,
  // even for a DEPOT_MANAGER editing a vehicle that's currently theirs.
  if (data.depotId && data.depotId !== before.depotId) {
    requireRole(session, "ORG_ADMIN");
  }

  const vehicle = await db.vehicle.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Vehicle",
    entityId: vehicle.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: vehicle,
    sourceChannel: "WEB",
  });

  return vehicle;
}

/** Soft-delete: master data referenced elsewhere (incidents, ...) is never hard-deleted. */
export async function archiveVehicle(session: AuthSession, id: string) {
  requireRole(session, ...WRITE_ROLES);
  const db = scopedDb(session.user.organizationId);

  const before = await db.vehicle.findUniqueOrThrow({ where: { id } });
  assertDepotInScope(session, before.depotId);

  const vehicle = await db.vehicle.update({
    where: { id },
    data: { status: "INACTIVE" },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Vehicle",
    entityId: vehicle.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: vehicle.status },
    sourceChannel: "WEB",
  });

  return vehicle;
}
