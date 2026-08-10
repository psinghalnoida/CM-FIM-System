import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { depotScopeFor } from "@/lib/masters/depot-scope";

export const CreateDepotSchema = z.object({
  cityId: z.uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500).optional(),
});
export type CreateDepotInput = z.infer<typeof CreateDepotSchema>;

export const UpdateDepotSchema = CreateDepotSchema.partial();
export type UpdateDepotInput = z.infer<typeof UpdateDepotSchema>;

/**
 * DEPOT_MANAGER only sees their own depot; every other role sees all
 * depots in the org — see lib/masters/depot-scope.ts.
 */
export async function listDepots(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  const scope = depotScopeFor(session);
  return db.depot.findMany({
    where: scope ? { id: scope } : undefined,
    orderBy: { name: "asc" },
  });
}

export async function getDepot(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  return db.depot.findUnique({ where: { id } });
}

/** Creating/editing depot records themselves is ORG_ADMIN-only — see docs/MASTERS.md. */
export async function createDepot(
  session: AuthSession,
  input: CreateDepotInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = CreateDepotSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const depot = await db.depot.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Depot",
    entityId: depot.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: depot,
    sourceChannel: "WEB",
  });

  return depot;
}

export async function updateDepot(
  session: AuthSession,
  id: string,
  input: UpdateDepotInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = UpdateDepotSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const before = await db.depot.findUniqueOrThrow({ where: { id } });
  const depot = await db.depot.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Depot",
    entityId: depot.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: depot,
    sourceChannel: "WEB",
  });

  return depot;
}
