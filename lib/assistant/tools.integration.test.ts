// Integration tests for M30's Mitra tool surface (lib/assistant/tools.ts)
// against a real Postgres instance: each tool's run() actually calls the
// real service-layer function with the caller's real session — so
// org-scoping/depot-scoping/RBAC apply exactly as everywhere else — and
// never throws on a bad/foreign id, instead returning a plain
// { error } result a chat model can explain.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim } from "@/lib/claims/claim";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";

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

async function seedOrg() {
  const org = await db.organization.create({
    data: { code: unique("M30"), name: "M30 Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({ data: { organizationId: org.id, name: "City" } });
  cleanup.cityIds.push(city.id);
  const depot = await db.depot.create({
    data: { organizationId: org.id, cityId: city.id, code: unique("D"), name: "Depot" },
  });
  cleanup.depotIds.push(depot.id);
  const vehicle = await db.vehicle.create({
    data: { organizationId: org.id, depotId: depot.id, registrationNumber: unique("VEH") },
  });
  cleanup.vehicleIds.push(vehicle.id);
  return { org, depot, vehicle };
}

async function userSessionWithRole(org: { id: string }, role: "ORG_ADMIN"): Promise<AuthSession> {
  const user = await db.user.create({
    data: { organizationId: org.id, name: role, email: `${unique(role)}@example.com`, role },
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

function tool(name: string) {
  const t = ASSISTANT_TOOLS.find((t) => t.name === name);
  if (!t) throw new Error(`tool "${name}" not registered`);
  return t;
}

describe("Mitra tools (M30)", () => {
  it("search_records finds a seeded incident/claim/vehicle by number/registration", async () => {
    const { org, vehicle } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const incident = await createIncident(admin, {
      vehicleId: vehicle.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M30 tool test incident.",
    });
    cleanup.incidentIds.push(incident.id);
    const claim = await createClaim(admin, { incidentId: incident.id, claimType: "INSURANCE" });
    cleanup.claimIds.push(claim.id);

    const byIncident = (await tool("search_records").run(admin, { query: incident.incidentNumber })) as Array<{
      type: string;
      id: string;
    }>;
    expect(byIncident.some((r) => r.type === "incident" && r.id === incident.id)).toBe(true);

    const byClaim = (await tool("search_records").run(admin, { query: claim.claimNumber })) as Array<{
      type: string;
      id: string;
    }>;
    expect(byClaim.some((r) => r.type === "claim" && r.id === claim.id)).toBe(true);

    const byVehicle = (await tool("search_records").run(admin, { query: vehicle.registrationNumber })) as Array<{
      type: string;
      id: string;
    }>;
    expect(byVehicle.some((r) => r.type === "vehicle" && r.id === vehicle.id)).toBe(true);
  });

  it("get_incident/get_claim/get_vehicle return the real record for a valid id", async () => {
    const { org, vehicle } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const incident = await createIncident(admin, {
      vehicleId: vehicle.id,
      incidentDateTime: new Date(),
      incidentType: "BREAKDOWN",
      description: "M30 tool test incident 2.",
    });
    cleanup.incidentIds.push(incident.id);
    const claim = await createClaim(admin, { incidentId: incident.id, claimType: "INSURANCE" });
    cleanup.claimIds.push(claim.id);

    const incidentResult = (await tool("get_incident").run(admin, { incidentId: incident.id })) as { id: string };
    expect(incidentResult.id).toBe(incident.id);

    const claimResult = (await tool("get_claim").run(admin, { claimId: claim.id })) as { id: string };
    expect(claimResult.id).toBe(claim.id);

    const vehicleResult = (await tool("get_vehicle").run(admin, { vehicleId: vehicle.id })) as { id: string };
    expect(vehicleResult.id).toBe(vehicle.id);
  });

  it("get_incident returns a plain { error } — never throws — for a nonexistent or cross-org id", async () => {
    const { org: orgA } = await seedOrg();
    const { org: orgB, vehicle: vehicleB } = await seedOrg();
    const adminA = await userSessionWithRole(orgA, "ORG_ADMIN");
    const adminB = await userSessionWithRole(orgB, "ORG_ADMIN");

    const incidentB = await createIncident(adminB, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M30 cross-org isolation test.",
    });
    cleanup.incidentIds.push(incidentB.id);

    const crossOrg = (await tool("get_incident").run(adminA, { incidentId: incidentB.id })) as { error: string };
    expect(crossOrg.error).toBeTruthy();

    const nonexistent = (await tool("get_incident").run(adminA, {
      incidentId: "00000000-0000-0000-0000-000000000000",
    })) as { error: string };
    expect(nonexistent.error).toBeTruthy();
  });

  it("get_incident returns { error } (not a thrown exception) for malformed args", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const result = (await tool("get_incident").run(admin, { wrongField: 123 })) as { error: string };
    expect(result.error).toBeTruthy();
  });

  it("get_my_work runs for the caller's own session with no arguments", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const result = (await tool("get_my_work").run(admin, {})) as { items: unknown[]; role: string };
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.role).toBe("ORG_ADMIN");
  });
});
