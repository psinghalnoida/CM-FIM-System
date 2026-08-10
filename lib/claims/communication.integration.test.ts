// Integration tests for the M20 claim-communication service
// (lib/claims/communication.ts) against a real Postgres instance: RBAC,
// depot-scoping through the parent claim/incident, and ordering — the
// same pattern as M7's survey/repair-job tests, applied to
// ActivityTimelineEvent instead of a dedicated model.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createClaim } from "@/lib/claims/claim";
import {
  addClaimCommunication,
  listClaimCommunications,
} from "@/lib/claims/communication";

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
  await db.activityTimelineEvent.deleteMany({
    where: { claimId: { in: cleanup.claimIds } },
  });
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.idCounter.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
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
  role: "ORG_ADMIN" | "DEPOT_MANAGER" | "CLAIMS_MANAGER" | "SURVEYOR",
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

async function seedOrgWithClaim() {
  const org = await db.organization.create({
    data: { code: unique("M20"), name: "M20 Test Org" },
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
  const incident = await db.incident.create({
    data: {
      organizationId: org.id,
      incidentNumber: unique("INC"),
      vehicleId: vehicle.id,
      depotId: depotA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M20 test incident.",
    },
  });
  cleanup.incidentIds.push(incident.id);
  const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
  const claim = await createClaim(admin, {
    incidentId: incident.id,
    claimType: "INSURANCE",
  });
  cleanup.claimIds.push(claim.id);
  return { org, depotA, depotB, claim, admin };
}

describe("addClaimCommunication", () => {
  it("ORG_ADMIN and CLAIMS_MANAGER can log a note; SURVEYOR cannot", async () => {
    const { org, claim } = await seedOrgWithClaim();
    const claimsManager = await userSessionWithRole(org, null, "CLAIMS_MANAGER");
    const surveyor = await userSessionWithRole(org, null, "SURVEYOR");

    const entry = await addClaimCommunication(claimsManager, claim.id, {
      description: "Called ABC Insurance — surveyor being appointed.",
    });
    expect(entry.claimId).toBe(claim.id);
    expect(entry.eventType).toBe("NOTE");
    expect(entry.actorId).toBe(claimsManager.user.id);

    await expect(
      addClaimCommunication(surveyor, claim.id, { description: "x" }),
    ).rejects.toThrow();
  });

  it("rejects a DEPOT_MANAGER from a different depot logging a note", async () => {
    const { depotB, org, claim } = await seedOrgWithClaim();
    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");

    await expect(
      addClaimCommunication(managerB, claim.id, { description: "x" }),
    ).rejects.toThrow();
  });
});

describe("listClaimCommunications", () => {
  it("lists entries in occurredAt order, depot-scoped for DEPOT_MANAGER via the claim's incident", async () => {
    const { admin, depotA, depotB, org, claim } = await seedOrgWithClaim();
    await addClaimCommunication(admin, claim.id, { description: "First." });
    await addClaimCommunication(admin, claim.id, { description: "Second." });

    const list = await listClaimCommunications(admin, claim.id);
    expect(list.map((e) => e.description)).toEqual(["First.", "Second."]);
    expect(list[0].actor?.id).toBe(admin.user.id);

    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const asManagerA = await listClaimCommunications(managerA, claim.id);
    expect(asManagerA).toHaveLength(2);

    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");
    await expect(listClaimCommunications(managerB, claim.id)).rejects.toThrow();
  });
});
