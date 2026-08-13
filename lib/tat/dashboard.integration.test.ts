// Integration tests for M23's TAT Dashboard (lib/tat/dashboard.ts)
// against a real Postgres instance: active-stage selection (IN_PROGRESS/
// ON_HOLD only, not PENDING/COMPLETED), breach detection, caseType/
// breachedOnly filters, and depot scoping.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim } from "@/lib/claims/claim";
import { createStageTemplate } from "@/lib/tat/stage-template";
import { startHold } from "@/lib/tat/case-stage";
import { getTatDashboard } from "@/lib/tat/dashboard";

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
  await db.auditLog.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.idCounter.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.tatHoldPeriod.deleteMany({
    where: { caseStageInstance: { organizationId: { in: cleanup.orgIds } } },
  });
  await db.caseStageInstance.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.tatStageTemplate.deleteMany({ where: { id: { in: cleanup.templateIds } } });
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
    data: { code: unique("M23"), name: "M23 Test Org" },
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
  return { org, city, depotA, depotB, vehicleA, vehicleB, admin };
}

describe("getTatDashboard (M23)", () => {
  it("lists only active stages, flags breaches, filters by caseType/breachedOnly, and depot-scopes for DEPOT_MANAGER", async () => {
    const { depotA, depotB, vehicleA, vehicleB, admin } =
      await seedOrgWithTwoDepots();

    const incidentTemplate = await createStageTemplate(admin, {
      caseType: "INCIDENT",
      stageKey: unique("STAGE").toUpperCase(),
      stageName: "Assessment",
      sequenceOrder: 0,
      targetHours: 1,
    });
    cleanup.templateIds.push(incidentTemplate.id);
    const claimTemplate = await createStageTemplate(admin, {
      caseType: "INSURANCE_CLAIM",
      stageKey: unique("STAGE").toUpperCase(),
      stageName: "Survey scheduling",
      sequenceOrder: 0,
      targetHours: 100,
    });
    cleanup.templateIds.push(claimTemplate.id);

    // Depot A: an IN_PROGRESS incident stage, backdated past its target — breached.
    const breachedIncident = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M23 test incident (breached).",
    });
    cleanup.incidentIds.push(breachedIncident.id);
    const breachedStage = await db.caseStageInstance.findFirstOrThrow({
      where: { incidentId: breachedIncident.id },
    });
    // computeElapsedTime's breach math is enteredAt-vs-now (not dueAt) —
    // see lib/tat/case-stage.ts — so backdate enteredAt (dueAt too, for
    // a consistent picture) to make this stage actually breach.
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await db.caseStageInstance.update({
      where: { id: breachedStage.id },
      data: { enteredAt: fiveHoursAgo, dueAt: fiveHoursAgo },
    });

    // Depot A: a second incident, its stage put ON_HOLD (not breached — target is 1h but not yet due, then held).
    const onHoldIncident = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "BREAKDOWN",
      description: "M23 test incident (on hold).",
    });
    cleanup.incidentIds.push(onHoldIncident.id);
    const onHoldStage = await db.caseStageInstance.findFirstOrThrow({
      where: { incidentId: onHoldIncident.id },
    });
    await startHold(admin, onHoldStage.id, {
      reason: "Testing on-hold inclusion.",
      responsibleParty: "OTHER",
    });

    // Depot B: a claim stage (INSURANCE_CLAIM), not breached.
    const incidentB = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M23 test incident B.",
    });
    cleanup.incidentIds.push(incidentB.id);
    const claim = await createClaim(admin, {
      incidentId: incidentB.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(claim.id);

    // Org-wide (ORG_ADMIN): all 4 active stages show up — the breached
    // and on-hold incident stages, plus incident B's own (untouched)
    // incident stage and its claim's stage.
    const orgWide = await getTatDashboard(admin);
    expect(orgWide.summary.totalActive).toBe(4);
    expect(orgWide.summary.inProgress).toBe(3);
    expect(orgWide.summary.onHold).toBe(1);
    expect(orgWide.summary.breached).toBe(1);

    // breachedOnly filter.
    const breachedOnly = await getTatDashboard(admin, { breachedOnly: true });
    expect(breachedOnly.rows).toHaveLength(1);
    expect(breachedOnly.rows[0].caseLabel).toBe(breachedIncident.incidentNumber);

    // caseType filter narrows to the claim-typed stage only.
    const claimOnly = await getTatDashboard(admin, {
      caseType: "INSURANCE_CLAIM",
    });
    expect(claimOnly.rows).toHaveLength(1);
    expect(claimOnly.rows[0].caseLabel).toBe(claim.claimNumber);

    // DEPOT_MANAGER at depot A sees only depot A's 2 active stages.
    const managerA = await userSessionWithRole(
      { id: admin.user.organizationId },
      depotA.id,
      "DEPOT_MANAGER",
    );
    const scopedToA = await getTatDashboard(managerA);
    expect(scopedToA.rows).toHaveLength(2);
    expect(scopedToA.rows.every((r) => r.depotId === depotA.id)).toBe(true);

    // DEPOT_MANAGER explicitly filtering by another depot gets [], not a leak.
    const crossDepot = await getTatDashboard(managerA, { depotId: depotB.id });
    expect(crossDepot.rows).toEqual([]);
    expect(crossDepot.summary.totalActive).toBe(0);
  });
});
