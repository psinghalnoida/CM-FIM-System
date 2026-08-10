// Integration tests for the M13 escalation-rule service
// (lib/escalations/escalation-rule.ts) against a real Postgres instance:
// RBAC, the exactly-one-recipient-target validation, and CRUD.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createStageTemplate } from "@/lib/tat/stage-template";
import {
  createEscalationRule,
  listEscalationRulesForStageTemplate,
  updateEscalationRule,
} from "@/lib/escalations/escalation-rule";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  ruleIds: [] as string[],
  templateIds: [] as string[],
  userIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.escalationRule.deleteMany({
    where: { id: { in: cleanup.ruleIds } },
  });
  await db.tatStageTemplate.deleteMany({
    where: { id: { in: cleanup.templateIds } },
  });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.ruleIds = [];
  cleanup.templateIds = [];
  cleanup.userIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function userSessionWithRole(
  org: { id: string },
  role: "ORG_ADMIN" | "CLAIMS_MANAGER",
): Promise<AuthSession> {
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      name: role,
      email: `${unique(role)}@example.com`,
      role,
    },
  });
  cleanup.userIds.push(user.id);
  return {
    id: "fake-session",
    userId: user.id,
    expiresAt: new Date(Date.now() + 100_000),
    revokedAt: null,
    createdAt: new Date(),
    user,
  } as AuthSession;
}

async function seedOrgWithStageTemplate() {
  const org = await db.organization.create({
    data: { code: unique("M13R"), name: "M13 Rule Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const admin = await userSessionWithRole(org, "ORG_ADMIN");
  const template = await createStageTemplate(admin, {
    caseType: "INCIDENT",
    stageKey: unique("STAGE").toUpperCase(),
    stageName: "Test stage",
    sequenceOrder: 0,
    targetHours: 24,
  });
  cleanup.templateIds.push(template.id);
  return { org, admin, template };
}

function track(id: string) {
  cleanup.ruleIds.push(id);
  return id;
}

describe("createEscalationRule", () => {
  it("ORG_ADMIN can create; CLAIMS_MANAGER cannot", async () => {
    const { org, admin, template } = await seedOrgWithStageTemplate();
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 4,
      notifyRole: "ORG_ADMIN",
    });
    track(rule.id);
    expect(rule.channel).toBe("EMAIL");

    await expect(
      createEscalationRule(claimsManager, {
        stageTemplateId: template.id,
        escalationLevel: 2,
        triggerAfterHoursBeyondTat: 8,
        notifyRole: "ORG_ADMIN",
      }),
    ).rejects.toThrow();

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "EscalationRule",
        entityId: rule.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects both notifyRole and notifyUserId set, and neither set", async () => {
    const { admin, template } = await seedOrgWithStageTemplate();

    await expect(
      createEscalationRule(admin, {
        stageTemplateId: template.id,
        escalationLevel: 1,
        triggerAfterHoursBeyondTat: 4,
        notifyRole: "ORG_ADMIN",
        notifyUserId: admin.user.id,
      }),
    ).rejects.toThrow();

    await expect(
      createEscalationRule(admin, {
        stageTemplateId: template.id,
        escalationLevel: 1,
        triggerAfterHoursBeyondTat: 4,
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (stageTemplateId, escalationLevel)", async () => {
    const { admin, template } = await seedOrgWithStageTemplate();
    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 4,
      notifyRole: "ORG_ADMIN",
    });
    track(rule.id);

    await expect(
      createEscalationRule(admin, {
        stageTemplateId: template.id,
        escalationLevel: 1,
        triggerAfterHoursBeyondTat: 8,
        notifyRole: "CLAIMS_MANAGER",
      }),
    ).rejects.toThrow();
  });
});

describe("updateEscalationRule / listEscalationRulesForStageTemplate", () => {
  it("updates the trigger threshold, records an UPDATE audit entry, and lists ordered by level", async () => {
    const { admin, template } = await seedOrgWithStageTemplate();
    const level2 = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 2,
      triggerAfterHoursBeyondTat: 24,
      notifyRole: "ORG_ADMIN",
    });
    track(level2.id);
    const level1 = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 4,
      notifyRole: "CLAIMS_MANAGER",
    });
    track(level1.id);

    const updated = await updateEscalationRule(admin, level1.id, {
      triggerAfterHoursBeyondTat: 6,
    });
    expect(updated.triggerAfterHoursBeyondTat).toBe(6);
    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "EscalationRule",
        entityId: level1.id,
        action: "UPDATE",
      },
    });
    expect(audit).not.toBeNull();

    const list = await listEscalationRulesForStageTemplate(admin, template.id);
    expect(list.map((r) => r.id)).toEqual([level1.id, level2.id]);
  });

  it("rejects an update that would leave both or neither recipient target set", async () => {
    const { admin, template } = await seedOrgWithStageTemplate();
    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 4,
      notifyRole: "ORG_ADMIN",
    });
    track(rule.id);

    await expect(
      updateEscalationRule(admin, rule.id, { notifyUserId: admin.user.id }),
    ).rejects.toThrow();
  });
});
