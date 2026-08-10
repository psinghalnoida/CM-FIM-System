// Integration tests for M25's Fleet Dashboard (lib/fleet/fleet-dashboard.ts)
// against a real Postgres instance: KPI counts, the filterable vehicle
// list (status/open-incidents/open-claims), and depot scoping.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim } from "@/lib/claims/claim";
import { getFleetKpis, listFleetVehicles } from "@/lib/fleet/fleet-dashboard";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
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
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
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

describe("Fleet Dashboard (M25)", () => {
  it("computes KPIs, filters the vehicle list, and depot-scopes for DEPOT_MANAGER", async () => {
    const org = await db.organization.create({
      data: { code: unique("M25"), name: "M25 Test Org" },
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
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    // Depot A: one vehicle with an open incident (no claim), one with an
    // open incident that has an open claim.
    const vehicleWithIncident = await db.vehicle.create({
      data: { organizationId: org.id, depotId: depotA.id, registrationNumber: unique("VA") },
    });
    const vehicleWithClaim = await db.vehicle.create({
      data: { organizationId: org.id, depotId: depotA.id, registrationNumber: unique("VA") },
    });
    // Depot B: one inactive vehicle, untouched.
    const idleVehicle = await db.vehicle.create({
      data: {
        organizationId: org.id,
        depotId: depotB.id,
        registrationNumber: unique("VB"),
        status: "INACTIVE",
      },
    });
    cleanup.vehicleIds.push(vehicleWithIncident.id, vehicleWithClaim.id, idleVehicle.id);

    const incident1 = await createIncident(admin, {
      vehicleId: vehicleWithIncident.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M25 fleet test 1.",
    });
    cleanup.incidentIds.push(incident1.id);

    const incident2 = await createIncident(admin, {
      vehicleId: vehicleWithClaim.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M25 fleet test 2.",
    });
    cleanup.incidentIds.push(incident2.id);
    const claim = await createClaim(admin, {
      incidentId: incident2.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(claim.id);

    // --- Org-wide KPIs. ---
    const kpis = await getFleetKpis(admin);
    expect(kpis.totalVehicles).toBe(3);
    expect(kpis.statusCounts.ACTIVE).toBe(2);
    expect(kpis.statusCounts.INACTIVE).toBe(1);
    expect(kpis.vehiclesWithOpenIncidents).toBe(2);
    expect(kpis.vehiclesWithOpenClaims).toBe(1);

    // --- Filters. ---
    const activeOnly = await listFleetVehicles(admin, { status: "ACTIVE" });
    expect(activeOnly).toHaveLength(2);

    const withOpenIncidents = await listFleetVehicles(admin, {
      hasOpenIncidents: true,
    });
    expect(withOpenIncidents).toHaveLength(2);

    const withOpenClaims = await listFleetVehicles(admin, {
      hasOpenClaims: true,
    });
    expect(withOpenClaims).toHaveLength(1);
    expect(withOpenClaims[0].id).toBe(vehicleWithClaim.id);

    // --- Depot scoping. ---
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const scopedToA = await listFleetVehicles(managerA);
    expect(scopedToA).toHaveLength(2);
    expect(scopedToA.every((v) => v.depotId === depotA.id)).toBe(true);

    const scopedKpis = await getFleetKpis(managerA);
    expect(scopedKpis.totalVehicles).toBe(2);

    // A DEPOT_MANAGER explicitly filtering by another depot gets [], not a leak.
    const crossDepot = await listFleetVehicles(managerA, { depotId: depotB.id });
    expect(crossDepot).toEqual([]);
    const crossDepotKpis = await getFleetKpis(managerA, { depotId: depotB.id });
    expect(crossDepotKpis.totalVehicles).toBe(0);
  });
});
