// Integration tests for the M17 global search service
// (lib/search/search.ts) against a real Postgres instance: match-by-
// number for each entity type, cross-org isolation, DEPOT_MANAGER
// confinement, and the short-query rejection.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { globalSearch } from "@/lib/search/search";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  incidentIds: [] as string[],
  claimIds: [] as string[],
  vehicleIds: [] as string[],
  userIds: [] as string[],
  depotIds: [] as string[],
  cityIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
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
  role: "ORG_ADMIN" | "DEPOT_MANAGER",
  depotId?: string,
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

/** Seeds an org with two depots, one incident+claim+vehicle at each. */
async function seedTwoDepotOrg(orgLabel: string) {
  const org = await db.organization.create({
    data: { code: unique(orgLabel), name: `${orgLabel} Org` },
  });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({
    data: { organizationId: org.id, name: "City" },
  });
  cleanup.cityIds.push(city.id);

  async function seedDepot(tag: string) {
    const depot = await db.depot.create({
      data: {
        organizationId: org.id,
        cityId: city.id,
        code: unique(`D-${tag}`),
        name: `Depot ${tag}`,
      },
    });
    cleanup.depotIds.push(depot.id);
    const regNumber = `SRCH-${tag}-${unique("V")}`;
    const vehicle = await db.vehicle.create({
      data: {
        organizationId: org.id,
        depotId: depot.id,
        registrationNumber: regNumber,
        make: "Tata",
      },
    });
    cleanup.vehicleIds.push(vehicle.id);
    const incidentNumber = `SRCH-INC-${tag}-${unique("N")}`;
    const incident = await db.incident.create({
      data: {
        organizationId: org.id,
        incidentNumber,
        vehicleId: vehicle.id,
        depotId: depot.id,
        incidentDateTime: new Date(),
        incidentType: "ACCIDENT",
        description: "Search test incident.",
      },
    });
    cleanup.incidentIds.push(incident.id);
    const claimNumber = `SRCH-CLM-${tag}-${unique("N")}`;
    const claim = await db.claim.create({
      data: {
        organizationId: org.id,
        claimNumber,
        incidentId: incident.id,
        claimType: "MAINTENANCE",
      },
    });
    cleanup.claimIds.push(claim.id);
    return {
      depot,
      vehicle,
      incident,
      claim,
      regNumber,
      incidentNumber,
      claimNumber,
    };
  }

  const depotA = await seedDepot("A");
  const depotB = await seedDepot("B");
  return { org, depotA, depotB };
}

describe("globalSearch", () => {
  it("finds an incident by a case-insensitive partial incidentNumber match", async () => {
    const { org, depotA } = await seedTwoDepotOrg("M17Inc");
    const admin = await userSessionWithRole(org, "ORG_ADMIN");

    const results = await globalSearch(admin, {
      q: depotA.incidentNumber.toLowerCase().slice(0, 10),
    });
    expect(
      results.some((r) => r.type === "incident" && r.id === depotA.incident.id),
    ).toBe(true);
  });

  it("finds a claim by a partial claimNumber match", async () => {
    const { org, depotA } = await seedTwoDepotOrg("M17Clm");
    const admin = await userSessionWithRole(org, "ORG_ADMIN");

    const results = await globalSearch(admin, {
      q: depotA.claimNumber.slice(0, 10),
    });
    expect(
      results.some((r) => r.type === "claim" && r.id === depotA.claim.id),
    ).toBe(true);
  });

  it("finds a vehicle by a partial registrationNumber match", async () => {
    const { org, depotA } = await seedTwoDepotOrg("M17Veh");
    const admin = await userSessionWithRole(org, "ORG_ADMIN");

    const results = await globalSearch(admin, {
      q: depotA.regNumber.slice(0, 8),
    });
    const match = results.find(
      (r) => r.type === "vehicle" && r.id === depotA.vehicle.id,
    );
    expect(match).toBeDefined();
    expect(match?.href).toBe(`/vehicles/${depotA.vehicle.id}/documents`);
  });

  it("never returns another organization's data, even with a matching-looking query", async () => {
    const { depotA: orgAIncident } = await seedTwoDepotOrg("M17OrgA");
    const { org: orgB } = await seedTwoDepotOrg("M17OrgB");
    const orgBAdmin = await userSessionWithRole(orgB, "ORG_ADMIN");

    const results = await globalSearch(orgBAdmin, {
      q: orgAIncident.incidentNumber,
    });
    expect(results).toHaveLength(0);
  });

  it("confines a DEPOT_MANAGER to their own depot's results", async () => {
    const { org, depotA, depotB } = await seedTwoDepotOrg("M17Depot");
    const depotAManager = await userSessionWithRole(
      org,
      "DEPOT_MANAGER",
      depotA.depot.id,
    );

    const ownDepotResults = await globalSearch(depotAManager, {
      q: depotA.regNumber.slice(0, 8),
    });
    expect(ownDepotResults.some((r) => r.id === depotA.vehicle.id)).toBe(true);

    const otherDepotResults = await globalSearch(depotAManager, {
      q: depotB.regNumber.slice(0, 8),
    });
    expect(otherDepotResults).toHaveLength(0);
  });

  it("rejects a query shorter than 2 characters", async () => {
    const { org } = await seedTwoDepotOrg("M17Short");
    const admin = await userSessionWithRole(org, "ORG_ADMIN");

    await expect(globalSearch(admin, { q: "a" })).rejects.toThrow();
  });
});
