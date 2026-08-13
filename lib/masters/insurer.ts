import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";

// M27: Insurer master data — formalizes what was free text
// (InsurancePolicy.insurerName) into a real, admin-managed entity. See
// docs/MASTERS.md's M27 section for the backfill plan.

export const CreateInsurerSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type CreateInsurerInput = z.infer<typeof CreateInsurerSchema>;

export const UpdateInsurerSchema = CreateInsurerSchema.partial();
export type UpdateInsurerInput = z.infer<typeof UpdateInsurerSchema>;

/** Any authenticated org member can read — reference data used when creating/displaying insurance policies. */
export async function listInsurers(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  return db.insurer.findMany({ orderBy: { name: "asc" } });
}

export async function getInsurer(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  return db.insurer.findUnique({ where: { id } });
}

/** Creating/editing master data is ORG_ADMIN-only — see docs/MASTERS.md. */
export async function createInsurer(
  session: AuthSession,
  input: CreateInsurerInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = CreateInsurerSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const insurer = await db.insurer.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Insurer",
    entityId: insurer.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: insurer,
    sourceChannel: "WEB",
  });

  return insurer;
}

export async function updateInsurer(
  session: AuthSession,
  id: string,
  input: UpdateInsurerInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = UpdateInsurerSchema.parse(input);
  const db = scopedDb(session.user.organizationId);

  const before = await db.insurer.findUniqueOrThrow({ where: { id } });
  const insurer = await db.insurer.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Insurer",
    entityId: insurer.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: insurer,
    sourceChannel: "WEB",
  });

  return insurer;
}
