// Integration tests for the M9 operational dashboard
// (lib/dashboards/operational-dashboard.ts) against a real Postgres
// instance: status counts, aging buckets, TAT breach counting (including
// the ON_HOLD exclusion), depot filtering, and org-scoping.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim, transitionClaimStatus } from "@/lib/claims/claim";
import { createStageTemplate } from "@/lib/tat/stage-template";
import { startHold } from "@/lib/tat/case-stage";
import { getOperationalDashboard } from "@/lib/dashboards/operational-dashboard";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
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
    where: { caseStageInstance: { organizationId: { in: cleanup.orgIds } } },
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
    user,
  } as AuthSession;
}

async function seedOrgWithTwoDepots() {
  const org = await db.organization.create({
    data: { code: unique("M9"), name: "M9 Test Org" },
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
  const vehicleA = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depotA.id,
      registrationNumber: unique("VA"),
    },
  });
  const vehicleB = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depotB.id,
      registrationNumber: unique("VB"),
    },
  });
  cleanup.vehicleIds.push(vehicleA.id, vehicleB.id);
  const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
  return { org, depotA, depotB, vehicleA, vehicleB, admin };
}

async function createIncidentAgedDays(
  admin: AuthSession,
  vehicleId: string,
  days: number,
) {
  const incident = await createIncident(admin, {
    vehicleId,
    incidentDateTime: new Date(),
    incidentType: "ACCIDENT",
    description: "Dashboard test incident.",
  });
  cleanup.incidentIds.push(incident.id);
  const reportedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await db.incident.update({
    where: { id: incident.id },
    data: { reportedAt },
  });
  return incident;
}

async function createClaimAgedDays(
  admin: AuthSession,
  incidentId: string,
  days: number,
) {
  const claim = await createClaim(admin, {
    incidentId,
    claimType: "MAINTENANCE",
  });
  cleanup.claimIds.push(claim.id);
  const openedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await db.claim.update({ where: { id: claim.id }, data: { openedAt } });
  return claim;
}

describe("status counts", () => {
  it("counts incidents and claims by status, org-wide", async () => {
    const { org, vehicleA, admin } = await seedOrgWithTwoDepots();

    const open1 = await createIncidentAgedDays(admin, vehicleA.id, 0);
    await createIncidentAgedDays(admin, vehicleA.id, 0);
    const toClose = await createIncidentAgedDays(admin, vehicleA.id, 0);
    await db.incident.update({
      where: { id: toClose.id },
      data: { status: "CLOSED" },
    });
    void open1;

    const dashboard = await getOperationalDashboard(admin);
    expect(dashboard.incidentStatusCounts.OPEN).toBe(2);
    expect(dashboard.incidentStatusCounts.CLOSED).toBe(1);
    void org;
  });
});

describe("aging", () => {
  it("buckets still-open incidents/claims into 0-3 / 4-7 / 8-14 / 15+ days", async () => {
    const { vehicleA, admin } = await seedOrgWithTwoDepots();

    await createIncidentAgedDays(admin, vehicleA.id, 1); // 0-3
    await createIncidentAgedDays(admin, vehicleA.id, 5); // 4-7
    await createIncidentAgedDays(admin, vehicleA.id, 10); // 8-14
    const old = await createIncidentAgedDays(admin, vehicleA.id, 20); // 15+

    const claimIncident = await createIncidentAgedDays(admin, vehicleA.id, 0);
    await createClaimAgedDays(admin, claimIncident.id, 2); // 0-3
    await createClaimAgedDays(admin, claimIncident.id, 9); // 8-14

    const dashboard = await getOperationalDashboard(admin);
    expect(dashboard.aging.incidents["0-3"]).toBe(2); // the 1-day-old + the claimIncident (0 days)
    expect(dashboard.aging.incidents["4-7"]).toBe(1);
    expect(dashboard.aging.incidents["8-14"]).toBe(1);
    expect(dashboard.aging.incidents["15+"]).toBe(1);
    expect(dashboard.aging.claims["0-3"]).toBe(1);
    expect(dashboard.aging.claims["8-14"]).toBe(1);
    void old;
  });

  it("a CLOSED incident and a CLOSED/REJECTED claim are excluded from aging", async () => {
    const { vehicleA, admin } = await seedOrgWithTwoDepots();

    const closedIncident = await createIncidentAgedDays(admin, vehicleA.id, 20);
    await db.incident.update({
      where: { id: closedIncident.id },
      data: { status: "CLOSED" },
    });

    const openIncident = await createIncidentAgedDays(admin, vehicleA.id, 0);
    const claim = await createClaimAgedDays(admin, openIncident.id, 20);
    await transitionClaimStatus(admin, claim.id, "REJECTED");

    const dashboard = await getOperationalDashboard(admin);
    expect(dashboard.aging.incidents["15+"]).toBe(0);
    expect(dashboard.aging.claims["15+"]).toBe(0);
  });
});

describe("TAT breaches", () => {
  it("counts an overdue IN_PROGRESS stage, excludes an overdue ON_HOLD stage", async () => {
    const { org, vehicleA, vehicleB, admin } = await seedOrgWithTwoDepots();

    const template = await createStageTemplate(admin, {
      caseType: "INCIDENT",
      stageKey: "M9_STAGE",
      stageName: "M9 stage",
      sequenceOrder: 0,
      targetHours: 1,
    });
    cleanup.templateIds.push(template.id);

    const inProgressIncident = await createIncidentAgedDays(
      admin,
      vehicleA.id,
      0,
    );
    const stage = await db.caseStageInstance.findFirstOrThrow({
      where: { incidentId: inProgressIncident.id },
    });
    const pastDueAt = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await db.caseStageInstance.update({
      where: { id: stage.id },
      data: { dueAt: pastDueAt },
    });

    const onHoldIncident = await createIncidentAgedDays(admin, vehicleB.id, 0);
    const onHoldStage = await db.caseStageInstance.findFirstOrThrow({
      where: { incidentId: onHoldIncident.id },
    });
    await db.caseStageInstance.update({
      where: { id: onHoldStage.id },
      data: { dueAt: pastDueAt },
    });
    await startHold(admin, onHoldStage.id, {
      reason: "Testing exclusion.",
      responsibleParty: "OTHER",
    });

    const dashboard = await getOperationalDashboard(admin);
    expect(dashboard.tatBreaches.totalCount).toBe(1);
    expect(dashboard.tatBreaches.incidentStageCount).toBe(1);
    expect(dashboard.tatBreaches.topBreached).toHaveLength(1);
    expect(dashboard.tatBreaches.topBreached[0].caseLabel).toBe(
      inProgressIncident.incidentNumber,
    );
    expect(dashboard.tatBreaches.topBreached[0].overdueHours).toBeGreaterThan(
      4,
    );
    void org;
  });
});

describe("depot scope", () => {
  it("filter.depotId narrows the dashboard to one depot", async () => {
    const { vehicleA, vehicleB, depotA, admin } = await seedOrgWithTwoDepots();
    await createIncidentAgedDays(admin, vehicleA.id, 0);
    await createIncidentAgedDays(admin, vehicleB.id, 0);

    const scoped = await getOperationalDashboard(admin, { depotId: depotA.id });
    expect(scoped.incidentStatusCounts.OPEN).toBe(1);
    expect(scoped.depotId).toBe(depotA.id);

    const orgWide = await getOperationalDashboard(admin);
    expect(orgWide.incidentStatusCounts.OPEN).toBe(2);
    expect(orgWide.depotId).toBeNull();
  });

  it("DEPOT_MANAGER's own depot always wins over a passed filter.depotId", async () => {
    const { org, vehicleA, vehicleB, depotA, depotB, admin } =
      await seedOrgWithTwoDepots();
    await createIncidentAgedDays(admin, vehicleA.id, 0);
    await createIncidentAgedDays(admin, vehicleB.id, 0);
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const dashboard = await getOperationalDashboard(managerA, {
      depotId: depotB.id,
    });
    expect(dashboard.depotId).toBe(depotA.id);
    expect(dashboard.incidentStatusCounts.OPEN).toBe(1);
  });
});

describe("org scoping", () => {
  it("a second organization's data never appears in this org's dashboard", async () => {
    const { vehicleA, admin } = await seedOrgWithTwoDepots();
    await createIncidentAgedDays(admin, vehicleA.id, 0);

    const other = await seedOrgWithTwoDepots();
    await createIncidentAgedDays(other.admin, other.vehicleA.id, 0);
    await createIncidentAgedDays(other.admin, other.vehicleA.id, 0);

    const dashboard = await getOperationalDashboard(admin);
    expect(dashboard.incidentStatusCounts.OPEN).toBe(1);
  });
});
