import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope } from "@/lib/masters/depot-scope";
import { DomainError } from "@/lib/domain-error";
import { SurveyStatus } from "@/lib/generated/prisma/enums";

// Surveys are a sub-workflow of a Claim (docs/schema/M2B.md). Surveyors
// are frequently external agency reps with no CM FIM System login, so
// surveyorName is always a plain string; surveyorUserId is set only when
// the surveyor happens to be an internal User. See docs/CLAIMS.md.

const WRITE_ROLES = ["ORG_ADMIN", "CLAIMS_MANAGER", "SURVEYOR"] as const;

export const SURVEY_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

async function generateSurveyNumber(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  organizationId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await tx.idCounter.upsert({
    where: {
      organizationId_entityType_year: {
        organizationId,
        entityType: "SURVEY",
        year,
      },
    },
    create: { organizationId, entityType: "SURVEY", year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `SUR-${year}-${String(counter.lastNumber).padStart(6, "0")}`;
}

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

export const CreateSurveySchema = z.object({
  claimId: z.uuid(),
  surveyorName: z.string().trim().min(1).max(200),
  surveyorContact: z.string().trim().max(100).optional(),
  surveyorUserId: z.uuid().optional(),
  scheduledAt: z.coerce.date().optional(),
});
export type CreateSurveyInput = z.infer<typeof CreateSurveySchema>;

export async function createSurvey(session: AuthSession, input: unknown) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateSurveySchema.parse(input);
  await assertClaimAccessible(session, data.claimId);

  if (data.surveyorUserId) {
    const scoped = scopedDb(session.user.organizationId);
    await scoped.user.findUniqueOrThrow({
      where: { id: data.surveyorUserId },
    });
  }

  const survey = await db.$transaction(async (tx) => {
    const surveyNumber = await generateSurveyNumber(
      tx,
      session.user.organizationId,
    );
    return tx.survey.create({
      data: {
        organizationId: session.user.organizationId,
        surveyNumber,
        claimId: data.claimId,
        surveyorName: data.surveyorName,
        surveyorContact: data.surveyorContact,
        surveyorUserId: data.surveyorUserId,
        scheduledAt: data.scheduledAt,
      },
    });
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Survey",
    entityId: survey.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: survey,
    sourceChannel: "WEB",
  });

  return survey;
}

export const UpdateSurveySchema = z.object({
  surveyorContact: z.string().trim().max(100).optional(),
  scheduledAt: z.coerce.date().optional(),
  conductedAt: z.coerce.date().optional(),
  findings: z.string().trim().max(4000).optional(),
});
export type UpdateSurveyInput = z.infer<typeof UpdateSurveySchema>;

export async function updateSurvey(
  session: AuthSession,
  id: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateSurveySchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.survey.findUniqueOrThrow({
    where: { id },
    include: { claim: { include: { incident: true } } },
  });
  assertDepotInScope(session, before.claim.incident.depotId);

  const survey = await scoped.survey.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Survey",
    entityId: survey.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: survey,
    sourceChannel: "WEB",
  });

  return survey;
}

export async function transitionSurveyStatus(
  session: AuthSession,
  id: string,
  to: SurveyStatus,
) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.survey.findUniqueOrThrow({
    where: { id },
    include: { claim: { include: { incident: true } } },
  });
  assertDepotInScope(session, before.claim.incident.depotId);

  const allowed = SURVEY_TRANSITIONS[before.status];
  if (!allowed.includes(to)) {
    throw new DomainError(
      `Cannot transition a survey from ${before.status} to ${to}.`,
      409,
    );
  }

  // conductedAt is set explicitly via updateSurvey, not inferred from a
  // status transition — keeps this function to one job (validate + apply
  // the transition) rather than guessing at a timestamp's meaning.
  const survey = await scoped.survey.update({
    where: { id },
    data: { status: to },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Survey",
    entityId: survey.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: survey.status },
    sourceChannel: "WEB",
  });

  return survey;
}

export async function getSurvey(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  const survey = await scoped.survey.findUnique({
    where: { id },
    include: { claim: { include: { incident: true } }, surveyorUser: true },
  });
  if (!survey) return null;
  assertDepotInScope(session, survey.claim.incident.depotId);
  return survey;
}

export async function listSurveysForClaim(
  session: AuthSession,
  claimId: string,
) {
  await assertClaimAccessible(session, claimId);
  const scoped = scopedDb(session.user.organizationId);
  return scoped.survey.findMany({
    where: { claimId },
    orderBy: { createdAt: "desc" },
  });
}
