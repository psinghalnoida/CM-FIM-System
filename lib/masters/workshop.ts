import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";

// M27: Workshop master data — formalizes what was free text on
// RepairJob (workshopName/workshopContact/workshopAddress) into a real,
// admin-managed entity. See docs/MASTERS.md's M27 section for the
// backfill plan.

export const CreateWorkshopSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contact: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
});
export type CreateWorkshopInput = z.infer<typeof CreateWorkshopSchema>;

export const UpdateWorkshopSchema = CreateWorkshopSchema.partial();
export type UpdateWorkshopInput = z.infer<typeof UpdateWorkshopSchema>;

/** Any authenticated org member can read — reference data used when creating/displaying repair jobs. */
export async function listWorkshops(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  return db.workshop.findMany({ orderBy: { name: "asc" } });
}

export async function getWorkshop(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  return db.workshop.findUnique({ where: { id } });
}

/** Creating/editing master data is ORG_ADMIN-only — see docs/MASTERS.md. */
export async function createWorkshop(
  session: AuthSession,
  input: CreateWorkshopInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = CreateWorkshopSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const workshop = await db.workshop.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Workshop",
    entityId: workshop.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: workshop,
    sourceChannel: "WEB",
  });

  return workshop;
}

export async function updateWorkshop(
  session: AuthSession,
  id: string,
  input: UpdateWorkshopInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = UpdateWorkshopSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const before = await db.workshop.findUniqueOrThrow({ where: { id } });
  const workshop = await db.workshop.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Workshop",
    entityId: workshop.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: workshop,
    sourceChannel: "WEB",
  });

  return workshop;
}
