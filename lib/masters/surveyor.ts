import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";

// M27: Surveyor master data — formalizes what was free text on Survey
// (surveyorName/surveyorContact/surveyorUserId) into a real,
// admin-managed entity. linkedUserId is set only when the surveyor is
// an internal user; most are external agency reps. See docs/MASTERS.md's
// M27 section for the backfill plan.

export const CreateSurveyorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contact: z.string().trim().max(100).optional(),
  linkedUserId: z.uuid().optional(),
});
export type CreateSurveyorInput = z.infer<typeof CreateSurveyorSchema>;

export const UpdateSurveyorSchema = CreateSurveyorSchema.partial();
export type UpdateSurveyorInput = z.infer<typeof UpdateSurveyorSchema>;

async function assertLinkedUserValid(
  session: AuthSession,
  linkedUserId: string | undefined,
) {
  if (!linkedUserId) return;
  const db = scopedDb(session.user.organizationId);
  await db.user.findUniqueOrThrow({ where: { id: linkedUserId } });
}

/** Any authenticated org member can read — reference data used when creating/displaying surveys. */
export async function listSurveyors(session: AuthSession) {
  const db = scopedDb(session.user.organizationId);
  return db.surveyor.findMany({ orderBy: { name: "asc" } });
}

export async function getSurveyor(session: AuthSession, id: string) {
  const db = scopedDb(session.user.organizationId);
  return db.surveyor.findUnique({ where: { id } });
}

/** Creating/editing master data is ORG_ADMIN-only — see docs/MASTERS.md. */
export async function createSurveyor(
  session: AuthSession,
  input: CreateSurveyorInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = CreateSurveyorSchema.parse(input);
  await assertLinkedUserValid(session, data.linkedUserId);
  const db = scopedDb(session.user.organizationId);

  const surveyor = await db.surveyor.create({
    data: { organizationId: session.user.organizationId, ...data },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Surveyor",
    entityId: surveyor.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: surveyor,
    sourceChannel: "WEB",
  });

  return surveyor;
}

export async function updateSurveyor(
  session: AuthSession,
  id: string,
  input: UpdateSurveyorInput,
) {
  requireRole(session, "ORG_ADMIN");
  const data = UpdateSurveyorSchema.parse(input);
  await assertLinkedUserValid(session, data.linkedUserId);
  const db = scopedDb(session.user.organizationId);

  const before = await db.surveyor.findUniqueOrThrow({ where: { id } });
  const surveyor = await db.surveyor.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Surveyor",
    entityId: surveyor.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: surveyor,
    sourceChannel: "WEB",
  });

  return surveyor;
}
