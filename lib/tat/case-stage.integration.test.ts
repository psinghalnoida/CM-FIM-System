// Integration tests for the M8 case-stage service (lib/tat/case-stage.ts)
// against a real Postgres instance: auto-instantiation from
// createIncident()/createClaim(), sequential auto-advance on completion,
// hold/end-hold (including PR-02's dueAt extension), RBAC, and
// depot-scoped reads.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim } from "@/lib/claims/claim";
import { createStageTemplate } from "@/lib/tat/stage-template";
import {
  completeStage,
  endHold,
  getStageInstance,
  listStageInstancesForCase,
  startHold,
} from "@/lib/tat/case-stage";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  stageInstanceIds: [] as string[],
  templateIds: [] as string[],
  claimIds: [] as string[],
  incidentIds: [] as string[],
  vehicleIds: [] as string[],
  userIds: [] as string[],
  depotIds: [] as string[],
  cityIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.idCounter.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.tatHoldPeriod.deleteMany({
    where: { caseStageInstanceId: { in: cleanup.stageInstanceIds } },
  });
  await db.caseStageInstance.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.tatStageTemplate.deleteMany({
    where: { id: { in: cleanup.templateIds } },
  });
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.stageInstanceIds = [];
  cleanup.templateIds = [];
  cleanup.claimIds = [];
  cleanup.incidentIds = [];
  cleanup.vehicleIds = [];
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function userSessionWithRole(
  org: { id: string },
  depotId: string | null,
  role: "ORG_ADMIN" | "DEPOT_MANAGER" | "CLAIMS_MANAGER",
): Promise<AuthSession> {
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      depotId,
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

async function seedOrgWithIncidentAndTwoStages() {
  const org = await db.organization.create({
    data: { code: unique("M8"), name: "M8 Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({
    data: { organizationId: org.id, name: "City" },
  });
  cleanup.cityIds.push(city.id);
  const depotA = await db.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: unique("DA"),
      name: "Depot A",
    },
  });
  const depotB = await db.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: unique("DB"),
      name: "Depot B",
    },
  });
  cleanup.depotIds.push(depotA.id, depotB.id);
  const vehicle = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depotA.id,
      registrationNumber: unique("V"),
    },
  });
  cleanup.vehicleIds.push(vehicle.id);
  const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

  const stage1 = await createStageTemplate(admin, {
    caseType: "INCIDENT",
    stageKey: "STAGE_ONE",
    stageName: "Stage one",
    sequenceOrder: 0,
    targetHours: 24,
  });
  cleanup.templateIds.push(stage1.id);
  const stage2 = await createStageTemplate(admin, {
    caseType: "INCIDENT",
    stageKey: "STAGE_TWO",
    stageName: "Stage two",
    sequenceOrder: 1,
    targetHours: 48,
  });
  cleanup.templateIds.push(stage2.id);

  const incident = await createIncident(admin, {
    vehicleId: vehicle.id,
    incidentDateTime: new Date(),
    incidentType: "ACCIDENT",
    description: "M8 test incident.",
  });
  cleanup.incidentIds.push(incident.id);

  return { org, depotA, depotB, vehicle, admin, incident, stage1, stage2 };
}

function trackAll(instances: { id: string }[]) {
  cleanup.stageInstanceIds.push(...instances.map((i) => i.id));
}

describe("instantiateStagesForCase (via createIncident)", () => {
  it("creates one instance per active template, first IN_PROGRESS with dueAt, rest PENDING with no dueAt", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();

    const instances = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(instances);
    expect(instances).toHaveLength(2);
    expect(instances[0].stageTemplate.stageName).toBe("Stage one");
    expect(instances[0].status).toBe("IN_PROGRESS");
    expect(instances[0].dueAt).not.toBeNull();
    expect(instances[1].stageTemplate.stageName).toBe("Stage two");
    expect(instances[1].status).toBe("PENDING");
    expect(instances[1].dueAt).toBeNull();
  });

  it("is a no-op when no templates are configured for the case type", async () => {
    const org = await db.organization.create({
      data: { code: unique("M8N"), name: "M8 No-template Org" },
    });
    cleanup.orgIds.push(org.id);
    const city = await db.city.create({
      data: { organizationId: org.id, name: "City" },
    });
    cleanup.cityIds.push(city.id);
    const depot = await db.depot.create({
      data: {
        organizationId: org.id,
        cityId: city.id,
        code: unique("D"),
        name: "Depot",
      },
    });
    cleanup.depotIds.push(depot.id);
    const vehicle = await db.vehicle.create({
      data: {
        organizationId: org.id,
        depotId: depot.id,
        registrationNumber: unique("V"),
      },
    });
    cleanup.vehicleIds.push(vehicle.id);
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const incident = await createIncident(admin, {
      vehicleId: vehicle.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "No templates.",
    });
    cleanup.incidentIds.push(incident.id);

    const instances = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    expect(instances).toHaveLength(0);
  });

  it("createClaim keys off the claim's own case type (INSURANCE_CLAIM), not INCIDENT's templates", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();

    const claimStage = await createStageTemplate(admin, {
      caseType: "INSURANCE_CLAIM",
      stageKey: "CLAIM_STAGE",
      stageName: "Claim stage",
      sequenceOrder: 0,
      targetHours: 72,
    });
    cleanup.templateIds.push(claimStage.id);

    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(claim.id);

    const claimInstances = await listStageInstancesForCase(admin, {
      claimId: claim.id,
    });
    trackAll(claimInstances);
    expect(claimInstances).toHaveLength(1);
    expect(claimInstances[0].stageTemplate.stageName).toBe("Claim stage");

    // The incident's own stages are untouched by the claim's creation.
    const incidentInstances = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(incidentInstances);
    expect(incidentInstances).toHaveLength(2);
  });
});

describe("completeStage", () => {
  it("completes the current stage and auto-advances the next PENDING stage to IN_PROGRESS", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();
    const before = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(before);
    const [first, second] = before;

    const completed = await completeStage(admin, first.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();

    const after = await getStageInstance(admin, second.id);
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.dueAt).not.toBeNull();

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "CaseStageInstance",
        entityId: first.id,
        action: "STATUS_CHANGE",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("completing the last stage leaves nothing PENDING to advance", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();
    const stages = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(stages);

    await completeStage(admin, stages[0].id);
    const last = await completeStage(admin, stages[1].id);
    expect(last.status).toBe("COMPLETED");
  });

  it("rejects completing a PENDING or already-COMPLETED stage (409)", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();
    const stages = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(stages);

    await expect(completeStage(admin, stages[1].id)).rejects.toThrow(
      /Cannot complete/,
    );

    await completeStage(admin, stages[0].id);
    await expect(completeStage(admin, stages[0].id)).rejects.toThrow(
      /Cannot complete/,
    );
  });
});

describe("startHold / endHold", () => {
  it("moves IN_PROGRESS -> ON_HOLD -> IN_PROGRESS and extends dueAt by the hold's duration", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();
    const stages = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(stages);
    const first = stages[0];
    const dueAtBeforeHold = first.dueAt!;

    const hold = await startHold(admin, first.id, {
      reason: "Awaiting driver statement.",
      responsibleParty: "DEPOT",
    });
    const onHold = await getStageInstance(admin, first.id);
    expect(onHold.status).toBe("ON_HOLD");

    // Simulate two hours of real hold time so the dueAt extension is
    // measurable without the test actually sleeping.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.tatHoldPeriod.update({
      where: { id: hold.id },
      data: { startedAt: twoHoursAgo },
    });

    const resumed = await endHold(admin, first.id);
    expect(resumed.status).toBe("IN_PROGRESS");
    const extensionMs = resumed.dueAt!.getTime() - dueAtBeforeHold.getTime();
    // ~2 hours, generous tolerance for test execution time.
    expect(extensionMs).toBeGreaterThan(1.9 * 60 * 60 * 1000);
    expect(extensionMs).toBeLessThan(2.2 * 60 * 60 * 1000);
  });

  it("rejects starting a hold on a non-IN_PROGRESS stage, and ending a hold on a non-ON_HOLD stage (409)", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();
    const stages = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(stages);

    await expect(
      startHold(admin, stages[1].id, {
        reason: "Stage is PENDING.",
        responsibleParty: "OTHER",
      }),
    ).rejects.toThrow(/Cannot place a hold/);

    await expect(endHold(admin, stages[0].id)).rejects.toThrow(/not on hold/);
  });
});

describe("computeElapsedTime (via getStageInstance)", () => {
  it("nets out held time against the wall-clock elapsed", async () => {
    const { admin, incident } = await seedOrgWithIncidentAndTwoStages();
    const stages = await listStageInstancesForCase(admin, {
      incidentId: incident.id,
    });
    trackAll(stages);
    const first = stages[0];

    const hold = await startHold(admin, first.id, {
      reason: "Testing elapsed math.",
      responsibleParty: "OTHER",
    });
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db.tatHoldPeriod.update({
      where: { id: hold.id },
      data: { startedAt: oneHourAgo },
    });

    // Still ON_HOLD (open-ended hold) — heldHours should be ~1, netHours
    // should be small (elapsed minus held), not the full wall-clock time.
    const stillHeld = await getStageInstance(admin, first.id);
    expect(stillHeld.elapsed.heldHours).toBeGreaterThan(0.9);
    expect(stillHeld.elapsed.netHours).toBeLessThan(
      stillHeld.elapsed.elapsedHours,
    );
  });
});

describe("RBAC and depot scope", () => {
  it("DEPOT_MANAGER can manage their own depot's incident stages, not another depot's", async () => {
    const { org, depotA, depotB, incident } =
      await seedOrgWithIncidentAndTwoStages();
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");
    const stages = await listStageInstancesForCase(managerA, {
      incidentId: incident.id,
    });
    trackAll(stages);

    const completed = await completeStage(managerA, stages[0].id);
    expect(completed.status).toBe("COMPLETED");

    await expect(
      listStageInstancesForCase(managerB, { incidentId: incident.id }),
    ).rejects.toThrow();
  });

  it("claim-typed stages use claim RBAC (CLAIMS_MANAGER, not DEPOT_MANAGER)", async () => {
    const { admin, depotA, org, incident } =
      await seedOrgWithIncidentAndTwoStages();
    const claimStage = await createStageTemplate(admin, {
      caseType: "MAINTENANCE_CLAIM",
      stageKey: "ONLY_STAGE",
      stageName: "Only stage",
      sequenceOrder: 0,
      targetHours: 24,
    });
    cleanup.templateIds.push(claimStage.id);
    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    cleanup.claimIds.push(claim.id);

    const claimsManager = await userSessionWithRole(
      org,
      null,
      "CLAIMS_MANAGER",
    );
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const stages = await listStageInstancesForCase(claimsManager, {
      claimId: claim.id,
    });
    trackAll(stages);

    const completed = await completeStage(claimsManager, stages[0].id);
    expect(completed.status).toBe("COMPLETED");

    const stages2 = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    cleanup.claimIds.push(stages2.id);
    const freshStages = await listStageInstancesForCase(admin, {
      claimId: stages2.id,
    });
    trackAll(freshStages);
    await expect(completeStage(managerA, freshStages[0].id)).rejects.toThrow();
  });
});
