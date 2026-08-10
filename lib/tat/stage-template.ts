import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { CaseType } from "@/lib/generated/prisma/enums";

// PR-01: every workflow stage has a configurable TAT. TatStageTemplate is
// the per-org/case-type configuration (stage name, order, target hours) —
// lib/tat/case-stage.ts instantiates real CaseStageInstance rows against
// it. See docs/TAT.md.

// Stage/TAT configuration is organization-wide policy, not day-to-day
// claims work — only ORG_ADMIN configures it. Every authenticated role
// can read (needed to render stage names/targets anywhere they're shown).
const WRITE_ROLES = ["ORG_ADMIN"] as const;

export const CreateStageTemplateSchema = z.object({
  caseType: z.enum(CaseType),
  stageKey: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z0-9_]+$/, "stageKey must be UPPER_SNAKE_CASE"),
  stageName: z.string().trim().min(1).max(200),
  sequenceOrder: z.number().int().min(0),
  targetHours: z.number().int().positive(),
  isActive: z.boolean().optional(),
});
export type CreateStageTemplateInput = z.infer<
  typeof CreateStageTemplateSchema
>;

export const UpdateStageTemplateSchema = z.object({
  stageName: z.string().trim().min(1).max(200).optional(),
  sequenceOrder: z.number().int().min(0).optional(),
  targetHours: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateStageTemplateInput = z.infer<
  typeof UpdateStageTemplateSchema
>;

export async function createStageTemplate(
  session: AuthSession,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateStageTemplateSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const template = await scoped.tatStageTemplate.create({
    data: {
      organizationId: session.user.organizationId,
      caseType: data.caseType,
      stageKey: data.stageKey,
      stageName: data.stageName,
      sequenceOrder: data.sequenceOrder,
      targetHours: data.targetHours,
      isActive: data.isActive ?? true,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "TatStageTemplate",
    entityId: template.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: template,
    sourceChannel: "WEB",
  });

  return template;
}

export async function updateStageTemplate(
  session: AuthSession,
  id: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateStageTemplateSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.tatStageTemplate.findUniqueOrThrow({
    where: { id },
  });
  const template = await scoped.tatStageTemplate.update({
    where: { id },
    data,
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "TatStageTemplate",
    entityId: template.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: template,
    sourceChannel: "WEB",
  });

  return template;
}

export async function getStageTemplate(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  return scoped.tatStageTemplate.findUnique({ where: { id } });
}

export interface ListStageTemplatesFilter {
  caseType?: CaseType;
  activeOnly?: boolean;
}

export async function listStageTemplates(
  session: AuthSession,
  filter: ListStageTemplatesFilter = {},
) {
  const scoped = scopedDb(session.user.organizationId);
  return scoped.tatStageTemplate.findMany({
    where: {
      caseType: filter.caseType,
      isActive: filter.activeOnly ? true : undefined,
    },
    orderBy: [{ caseType: "asc" }, { sequenceOrder: "asc" }],
  });
}
