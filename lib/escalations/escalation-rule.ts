import "server-only";
import { z } from "zod";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/domain-error";
import { EscalationChannel, UserRole } from "@/lib/generated/prisma/enums";

// M13: EscalationRule configuration — who to notify, how far past TAT,
// on which channel. Firing them is lib/escalations/scan.ts's job; this
// file is CRUD only. See docs/ESCALATIONS.md.

// Same tier as lib/tat/stage-template.ts's TatStageTemplate config —
// ORG_ADMIN only configures the escalation hierarchy; every authenticated
// role can read it (needed anywhere a stage's escalation config is shown).
const WRITE_ROLES = ["ORG_ADMIN"] as const;

const RecipientSchema = z
  .object({
    notifyRole: z.enum(UserRole).optional(),
    notifyUserId: z.uuid().optional(),
  })
  .refine((data) => Boolean(data.notifyRole) !== Boolean(data.notifyUserId), {
    message: "Exactly one of notifyRole or notifyUserId must be set.",
  });

export const CreateEscalationRuleSchema = z
  .object({
    stageTemplateId: z.uuid(),
    escalationLevel: z.number().int().positive(),
    triggerAfterHoursBeyondTat: z.number().int().min(0),
    channel: z.enum(EscalationChannel).optional(),
  })
  .and(RecipientSchema);
export type CreateEscalationRuleInput = z.infer<
  typeof CreateEscalationRuleSchema
>;

export const UpdateEscalationRuleSchema = z.object({
  triggerAfterHoursBeyondTat: z.number().int().min(0).optional(),
  notifyRole: z.enum(UserRole).nullable().optional(),
  notifyUserId: z.uuid().nullable().optional(),
  channel: z.enum(EscalationChannel).optional(),
});
export type UpdateEscalationRuleInput = z.infer<
  typeof UpdateEscalationRuleSchema
>;

export async function createEscalationRule(
  session: AuthSession,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateEscalationRuleSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  await scoped.tatStageTemplate.findUniqueOrThrow({
    where: { id: data.stageTemplateId },
  });
  if (data.notifyUserId) {
    await scoped.user.findUniqueOrThrow({ where: { id: data.notifyUserId } });
  }

  const rule = await scoped.escalationRule.create({
    data: {
      organizationId: session.user.organizationId,
      stageTemplateId: data.stageTemplateId,
      escalationLevel: data.escalationLevel,
      triggerAfterHoursBeyondTat: data.triggerAfterHoursBeyondTat,
      notifyRole: data.notifyRole,
      notifyUserId: data.notifyUserId,
      channel: data.channel ?? EscalationChannel.EMAIL,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "EscalationRule",
    entityId: rule.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: rule,
    sourceChannel: "WEB",
  });

  return rule;
}

export async function updateEscalationRule(
  session: AuthSession,
  id: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateEscalationRuleSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.escalationRule.findUniqueOrThrow({
    where: { id },
  });
  if (data.notifyUserId) {
    await scoped.user.findUniqueOrThrow({ where: { id: data.notifyUserId } });
  }
  const nextNotifyRole =
    data.notifyRole !== undefined ? data.notifyRole : before.notifyRole;
  const nextNotifyUserId =
    data.notifyUserId !== undefined ? data.notifyUserId : before.notifyUserId;
  if (Boolean(nextNotifyRole) === Boolean(nextNotifyUserId)) {
    throw new DomainError(
      "Exactly one of notifyRole or notifyUserId must be set.",
    );
  }

  const rule = await scoped.escalationRule.update({
    where: { id },
    data,
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "EscalationRule",
    entityId: rule.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: rule,
    sourceChannel: "WEB",
  });

  return rule;
}

export async function listEscalationRulesForStageTemplate(
  session: AuthSession,
  stageTemplateId: string,
) {
  const scoped = scopedDb(session.user.organizationId);
  return scoped.escalationRule.findMany({
    where: { stageTemplateId },
    orderBy: { escalationLevel: "asc" },
  });
}
