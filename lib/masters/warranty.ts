import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope } from "@/lib/masters/depot-scope";

// M28: the Vehicle Detail page's Warranty tab. Basic terms only —
// provider (free text, same Phase-1 pattern InsurancePolicy.insurerName
// used before M27; not a master table, since nothing asked for a
// "warranty provider master" the way the design explicitly named
// Insurer/Surveyor/Workshop), a coverage description, and a validity
// window. Multiple warranties per vehicle are allowed (e.g. the
// manufacturer's original plus a separately-purchased extended one).
// See docs/MASTERS.md's M28 section.

export const CreateWarrantySchema = z
  .object({
    vehicleId: z.uuid(),
    provider: z.string().trim().min(1).max(200),
    coverageDescription: z.string().trim().max(1000).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: "endDate must be after startDate.",
    path: ["endDate"],
  });
export type CreateWarrantyInput = z.infer<typeof CreateWarrantySchema>;

export const UpdateWarrantySchema = z.object({
  provider: z.string().trim().min(1).max(200).optional(),
  coverageDescription: z.string().trim().max(1000).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
export type UpdateWarrantyInput = z.infer<typeof UpdateWarrantySchema>;

/** Same write-access tier as the Vehicle it's attached to — see lib/masters/vehicle.ts. */
const WRITE_ROLES = ["ORG_ADMIN", "DEPOT_MANAGER"] as const;

async function assertVehicleAccessible(session: AuthSession, vehicleId: string) {
  const scoped = scopedDb(session.user.organizationId);
  const vehicle = await scoped.vehicle.findUniqueOrThrow({
    where: { id: vehicleId },
  });
  assertDepotInScope(session, vehicle.depotId);
  return vehicle;
}

/** Any authenticated org member can read — same tier as Vehicle itself. */
export async function listWarrantiesForVehicle(
  session: AuthSession,
  vehicleId: string,
) {
  await assertVehicleAccessible(session, vehicleId);
  const scoped = scopedDb(session.user.organizationId);
  return scoped.warranty.findMany({
    where: { vehicleId },
    orderBy: { startDate: "desc" },
  });
}

export async function createWarranty(
  session: AuthSession,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateWarrantySchema.parse(input);
  await assertVehicleAccessible(session, data.vehicleId);
  const scoped = scopedDb(session.user.organizationId);

  const warranty = await scoped.warranty.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Warranty",
    entityId: warranty.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: warranty,
    sourceChannel: "WEB",
  });

  return warranty;
}

async function assertWarrantyAccessible(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  const warranty = await scoped.warranty.findUniqueOrThrow({ where: { id } });
  await assertVehicleAccessible(session, warranty.vehicleId);
  return warranty;
}

export async function updateWarranty(
  session: AuthSession,
  id: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateWarrantySchema.parse(input);
  const before = await assertWarrantyAccessible(session, id);

  const scoped = scopedDb(session.user.organizationId);
  const warranty = await scoped.warranty.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Warranty",
    entityId: warranty.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: warranty,
    sourceChannel: "WEB",
  });

  return warranty;
}
