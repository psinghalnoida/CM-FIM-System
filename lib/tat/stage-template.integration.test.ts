// Integration tests for the M8 stage-template service
// (lib/tat/stage-template.ts) against a real Postgres instance: RBAC and
// CRUD.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import {
  createStageTemplate,
  listStageTemplates,
  updateStageTemplate,
} from "@/lib/tat/stage-template";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  templateIds: [] as string[],
  userIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.tatStageTemplate.deleteMany({
    where: { id: { in: cleanup.templateIds } },
  });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.templateIds = [];
  cleanup.userIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedOrg() {
  const org = await db.organization.create({
    data: { code: unique("M8T"), name: "M8 Template Test Org" },
  });
  cleanup.orgIds.push(org.id);
  return org;
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

function track(id: string) {
  cleanup.templateIds.push(id);
  return id;
}

describe("createStageTemplate", () => {
  it("ORG_ADMIN can create; CLAIMS_MANAGER cannot", async () => {
    const org = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    const template = await createStageTemplate(admin, {
      caseType: "INCIDENT",
      stageKey: "INITIAL_REVIEW",
      stageName: "Initial review",
      sequenceOrder: 0,
      targetHours: 24,
    });
    track(template.id);
    expect(template.id).toBeDefined();

    await expect(
      createStageTemplate(claimsManager, {
        caseType: "INCIDENT",
        stageKey: "SHOULD_FAIL",
        stageName: "Should fail",
        sequenceOrder: 1,
        targetHours: 24,
      }),
    ).rejects.toThrow();

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "TatStageTemplate",
        entityId: template.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a duplicate (organizationId, caseType, stageKey)", async () => {
    const org = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");

    const template = await createStageTemplate(admin, {
      caseType: "INCIDENT",
      stageKey: "DUP",
      stageName: "First",
      sequenceOrder: 0,
      targetHours: 24,
    });
    track(template.id);

    await expect(
      createStageTemplate(admin, {
        caseType: "INCIDENT",
        stageKey: "DUP",
        stageName: "Second",
        sequenceOrder: 1,
        targetHours: 24,
      }),
    ).rejects.toThrow();
  });
});

describe("updateStageTemplate / listStageTemplates", () => {
  it("updates targetHours, records an UPDATE audit entry, and lists ordered by sequenceOrder", async () => {
    const org = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");

    const second = await createStageTemplate(admin, {
      caseType: "INSURANCE_CLAIM",
      stageKey: "SECOND",
      stageName: "Second",
      sequenceOrder: 1,
      targetHours: 48,
    });
    track(second.id);
    const first = await createStageTemplate(admin, {
      caseType: "INSURANCE_CLAIM",
      stageKey: "FIRST",
      stageName: "First",
      sequenceOrder: 0,
      targetHours: 24,
    });
    track(first.id);

    const updated = await updateStageTemplate(admin, first.id, {
      targetHours: 12,
    });
    expect(updated.targetHours).toBe(12);
    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "TatStageTemplate",
        entityId: first.id,
        action: "UPDATE",
      },
    });
    expect(audit).not.toBeNull();

    const list = await listStageTemplates(admin, {
      caseType: "INSURANCE_CLAIM",
    });
    expect(list.map((t) => t.id)).toEqual([first.id, second.id]);
  });
});
