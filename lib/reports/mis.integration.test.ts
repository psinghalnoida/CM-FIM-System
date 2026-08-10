// Integration tests for M24's MIS Reports (lib/reports/mis.ts) against a
// real Postgres instance: claim ageing buckets, TAT compliance %,
// incident-type frequency, repair turnaround by depot, and depot
// scoping.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim } from "@/lib/claims/claim";
import { createRepairJob, updateRepairJob } from "@/lib/claims/repair-job";
import { createStageTemplate } from "@/lib/tat/stage-template";
import { completeStage } from "@/lib/tat/case-stage";
import { getMisReport } from "@/lib/reports/mis";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  templateIds: [] as string[],
  repairJobIds: [] as string[],
  claimIds: [] as string[],
  incidentIds: [] as string[],
  vehicleIds: [] as string[],
  userIds: [] as string[],
  depotIds: [] as string[],
  cityIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.idCounter.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.tatHoldPeriod.deleteMany({
    where: { caseStageInstance: { organizationId: { in: cleanup.orgIds } } },
  });
  await db.caseStageInstance.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.tatStageTemplate.deleteMany({ where: { id: { in: cleanup.templateIds } } });
  await db.repairJob.deleteMany({ where: { id: { in: cleanup.repairJobIds } } });
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.templateIds = [];
  cleanup.repairJobIds = [];
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
  role: "ORG_ADMIN" | "DEPOT_MANAGER",
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
    user: {
      id: user.id,
      organizationId: org.id,
      role,
      depotId,
      name: role,
      email: user.email,
      status: "ACTIVE",
    },
  } as AuthSession;
}

async function seedOrgWithTwoDepots() {
  const org = await db.organization.create({
    data: { code: unique("M24"), name: "M24 Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({ data: { organizationId: org.id, name: "City" } });
  cleanup.cityIds.push(city.id);
  const depotA = await db.depot.create({
    data: { organizationId: org.id, cityId: city.id, code: unique("DA"), name: "Depot A" },
  });
  const depotB = await db.depot.create({
    data: { organizationId: org.id, cityId: city.id, code: unique("DB"), name: "Depot B" },
  });
  cleanup.depotIds.push(depotA.id, depotB.id);
  const vehicleA = await db.vehicle.create({
    data: { organizationId: org.id, depotId: depotA.id, registrationNumber: unique("VA") },
  });
  const vehicleB = await db.vehicle.create({
    data: { organizationId: org.id, depotId: depotB.id, registrationNumber: unique("VB") },
  });
  cleanup.vehicleIds.push(vehicleA.id, vehicleB.id);
  const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
  return { org, depotA, depotB, vehicleA, vehicleB, admin };
}

describe("getMisReport (M24)", () => {
  it("computes claim ageing, TAT compliance %, incident-type frequency, and repair turnaround by depot", async () => {
    const { depotA, depotB, vehicleA, vehicleB, admin } =
      await seedOrgWithTwoDepots();

    // --- Claim ageing: one fresh open claim, one 10 days old. ---
    const incidentForClaim1 = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M24 claim ageing test 1.",
    });
    cleanup.incidentIds.push(incidentForClaim1.id);
    const freshClaim = await createClaim(admin, {
      incidentId: incidentForClaim1.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(freshClaim.id);

    const incidentForClaim2 = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M24 claim ageing test 2.",
    });
    cleanup.incidentIds.push(incidentForClaim2.id);
    const oldClaim = await createClaim(admin, {
      incidentId: incidentForClaim2.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(oldClaim.id);
    await db.claim.update({
      where: { id: oldClaim.id },
      data: { openedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    });

    // --- TAT compliance: one stage completed quickly (compliant), one
    // completed after being backdated past its target (breached). ---
    const template = await createStageTemplate(admin, {
      caseType: "INCIDENT",
      stageKey: unique("STAGE").toUpperCase(),
      stageName: "Assessment",
      sequenceOrder: 0,
      targetHours: 1,
    });
    cleanup.templateIds.push(template.id);

    const compliantIncident = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M24 TAT compliance test (compliant).",
    });
    cleanup.incidentIds.push(compliantIncident.id);
    const compliantStage = await db.caseStageInstance.findFirstOrThrow({
      where: { incidentId: compliantIncident.id },
    });
    await completeStage(admin, compliantStage.id);

    const breachedIncident = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M24 TAT compliance test (breached).",
    });
    cleanup.incidentIds.push(breachedIncident.id);
    const breachedStage = await db.caseStageInstance.findFirstOrThrow({
      where: { incidentId: breachedIncident.id },
    });
    await db.caseStageInstance.update({
      where: { id: breachedStage.id },
      data: { enteredAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
    });
    await completeStage(admin, breachedStage.id);

    // --- Incident-type frequency: 2 more ACCIDENTs (from above) + 1
    // BREAKDOWN. ---
    const breakdownIncident = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "BREAKDOWN",
      description: "M24 incident-type frequency test.",
    });
    cleanup.incidentIds.push(breakdownIncident.id);

    // --- Repair turnaround: a repair job at depot A, 10 days start-to-end. ---
    const incidentForRepair = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M24 repair turnaround test.",
    });
    cleanup.incidentIds.push(incidentForRepair.id);
    const claimForRepair = await createClaim(admin, {
      incidentId: incidentForRepair.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(claimForRepair.id);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const repairJob = await createRepairJob(admin, {
      claimId: claimForRepair.id,
      workshopName: "Test Workshop",
      startDate: tenDaysAgo,
    });
    cleanup.repairJobIds.push(repairJob.id);
    await updateRepairJob(admin, repairJob.id, { endDate: new Date() });

    // --- Assertions, org-wide. ---
    const report = await getMisReport(admin);

    // freshClaim and claimForRepair (created later, for the repair-job
    // test) are both fresh open claims.
    expect(report.claimAgeing["0-3"]).toBe(2);
    expect(report.claimAgeing["8-14"]).toBe(1);

    expect(report.tatCompliance.totalCompletedStages).toBe(2);
    expect(report.tatCompliance.compliantStages).toBe(1);
    expect(report.tatCompliance.compliancePercent).toBe(50);

    expect(report.incidentTypeFrequency.ACCIDENT).toBeGreaterThanOrEqual(4);
    expect(report.incidentTypeFrequency.BREAKDOWN).toBe(1);

    const depotARow = report.repairTurnaroundByDepot.find(
      (r) => r.depotId === depotA.id,
    );
    expect(depotARow?.completedJobCount).toBe(1);
    expect(depotARow?.avgTurnaroundDays).toBeCloseTo(10, 0);
    const depotBRow = report.repairTurnaroundByDepot.find(
      (r) => r.depotId === depotB.id,
    );
    expect(depotBRow?.completedJobCount).toBe(0);
    expect(depotBRow?.avgTurnaroundDays).toBeNull();

    // --- Depot scoping: filtered to depot B sees none of depot A's data. ---
    const depotBOnly = await getMisReport(admin, { depotId: depotB.id });
    expect(depotBOnly.incidentTypeFrequency.BREAKDOWN).toBe(1);
    expect(depotBOnly.incidentTypeFrequency.ACCIDENT).toBe(0);
    expect(depotBOnly.tatCompliance.totalCompletedStages).toBe(0);

    // --- DEPOT_MANAGER at depot A explicitly filtering by depot B gets
    // an empty report, not a leak. ---
    const managerA = await userSessionWithRole(
      { id: admin.user.organizationId },
      depotA.id,
      "DEPOT_MANAGER",
    );
    const crossDepot = await getMisReport(managerA, { depotId: depotB.id });
    expect(crossDepot.repairTurnaroundByDepot).toEqual([]);
    expect(crossDepot.tatCompliance.compliancePercent).toBeNull();
  });
});
