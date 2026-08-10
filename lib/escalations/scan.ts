// No "server-only" guard — this module is imported directly by
// workers/index.ts (a standalone `tsx` script outside Next's build), the
// M11 lesson applied from the start (docs/OCR.md).

import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { getEmailProvider } from "@/lib/email/provider";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  CaseStageStatus,
  EscalationChannel,
} from "@/lib/generated/prisma/enums";
import type { EscalationRule } from "@/lib/generated/prisma/client";

// PR-03: the reminder scheduler — periodically finds breached, still-
// IN_PROGRESS stages (the same PR-02 exclusion M9's dashboard uses: an
// ON_HOLD stage's clock is paused, so it never counts as breaching here
// either) and fires each configured EscalationRule whose threshold has
// been crossed and hasn't already fired for that stage. Runs with no
// user session — this is a system sweep, not a user action, so it reads
// the plain `db` client directly rather than scopedDb(). See
// docs/ESCALATIONS.md.

export interface FiredEscalation {
  caseStageInstanceId: string;
  escalationRuleId: string;
  escalationLevel: number;
  notifiedEmails: string[];
  caseLabel: string;
  stageName: string;
}

export interface ScanResult {
  breachedStageCount: number;
  fired: FiredEscalation[];
  skippedNonEmailCount: number;
}

/**
 * Resolves who a rule's notifyRole/notifyUserId actually points at right
 * now (a live lookup, not stored — role membership can change between
 * scans). A DEPOT_MANAGER-role rule on an incident-typed stage is
 * confined to that incident's own depot (matching M6-M8's depot-scoping
 * precedent) — every other role/case-type combination is org-wide, since
 * every other role already is in this system. An unresolvable target
 * (inactive user, nobody currently holds the role) returns no
 * recipients — the rule is simply retried on the next scan, not treated
 * as an error.
 */
async function resolveRecipients(
  stage: {
    organizationId: string;
    incidentId: string | null;
    incident: { depotId: string } | null;
  },
  rule: EscalationRule,
): Promise<string[]> {
  if (rule.notifyUserId) {
    const user = await db.user.findUnique({ where: { id: rule.notifyUserId } });
    return user && user.status === "ACTIVE" ? [user.email] : [];
  }
  if (rule.notifyRole) {
    const depotId =
      rule.notifyRole === "DEPOT_MANAGER" && stage.incident
        ? stage.incident.depotId
        : undefined;
    const users = await db.user.findMany({
      where: {
        organizationId: stage.organizationId,
        role: rule.notifyRole,
        status: "ACTIVE",
        ...(depotId ? { depotId } : {}),
      },
    });
    return users.map((u) => u.email);
  }
  return [];
}

/**
 * Scans for breaches and fires due escalations. `organizationId` narrows
 * to one org (used by the manual "scan now" API endpoint, scoped to the
 * caller's own org); omitted, it sweeps every org — what the repeatable
 * worker job does.
 */
export async function scanAndFireEscalations(
  organizationId?: string,
): Promise<ScanResult> {
  const now = new Date();
  const breachedStages = await db.caseStageInstance.findMany({
    where: {
      status: CaseStageStatus.IN_PROGRESS,
      dueAt: { lt: now },
      ...(organizationId ? { organizationId } : {}),
    },
    include: {
      stageTemplate: {
        include: { escalationRules: { orderBy: { escalationLevel: "asc" } } },
      },
      incident: true,
      claim: true,
    },
  });

  const fired: FiredEscalation[] = [];
  let skippedNonEmailCount = 0;

  for (const stage of breachedStages) {
    const overdueHours = (now.getTime() - stage.dueAt!.getTime()) / 3_600_000;

    for (const rule of stage.stageTemplate.escalationRules) {
      if (overdueHours < rule.triggerAfterHoursBeyondTat) continue;

      const alreadyFired = await db.escalationEvent.findUnique({
        where: {
          caseStageInstanceId_escalationRuleId: {
            caseStageInstanceId: stage.id,
            escalationRuleId: rule.id,
          },
        },
      });
      if (alreadyFired) continue;

      if (rule.channel !== EscalationChannel.EMAIL) {
        // WHATSAPP/SMS rules are accepted at config time but inert until
        // their adapters exist (M10/a future SMS adapter) — visibly
        // skipped, not silently dropped, and not recorded as fired, so
        // they'll correctly fire retroactively once that channel lands.
        skippedNonEmailCount += 1;
        continue;
      }

      const recipients = await resolveRecipients(stage, rule);
      if (recipients.length === 0) continue;

      const caseLabel =
        stage.incident?.incidentNumber ?? stage.claim?.claimNumber ?? stage.id;

      const provider = await getEmailProvider();
      await provider.send({
        to: recipients,
        subject: `[CM FIM] TAT breach — ${caseLabel} — ${stage.stageTemplate.stageName}`,
        html:
          `<p><strong>${caseLabel}</strong>'s "${stage.stageTemplate.stageName}" stage ` +
          `is ${overdueHours.toFixed(1)} hours past its TAT target ` +
          `(escalation level ${rule.escalationLevel}).</p>`,
      });

      let event;
      try {
        event = await db.escalationEvent.create({
          data: {
            organizationId: stage.organizationId,
            caseStageInstanceId: stage.id,
            escalationRuleId: rule.id,
            channel: rule.channel,
            notifiedEmails: recipients,
          },
        });
      } catch (err) {
        // The unique constraint is the real backstop against a duplicate
        // firing (e.g. a concurrent scan run) — the alreadyFired check
        // above is the fast path, this is what actually guarantees it.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          continue;
        }
        throw err;
      }

      await recordAudit({
        organizationId: stage.organizationId,
        entityType: "EscalationEvent",
        entityId: event.id,
        action: "CREATE",
        actorId: null,
        afterData: {
          caseStageInstanceId: stage.id,
          escalationRuleId: rule.id,
          notifiedEmails: recipients,
        },
        sourceChannel: "SYSTEM",
      });

      fired.push({
        caseStageInstanceId: stage.id,
        escalationRuleId: rule.id,
        escalationLevel: rule.escalationLevel,
        notifiedEmails: recipients,
        caseLabel,
        stageName: stage.stageTemplate.stageName,
      });
    }
  }

  return {
    breachedStageCount: breachedStages.length,
    fired,
    skippedNonEmailCount,
  };
}
