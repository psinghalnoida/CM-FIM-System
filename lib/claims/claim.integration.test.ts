// Integration tests for the M7 claim service (lib/claims/claim.ts) against
// a real Postgres instance: RBAC, BR-05 policy auto-selection, human-
// readable ID generation, and the ClaimStatus transition map.
//
// Sessions are faked, same as lib/incidents/incident.integration.test.ts —
// see that file's header for why.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import {
  createClaim,
  getClaim,
  listClaims,
  transitionClaimStatus,
  updateClaim,
} from "@/lib/claims/claim";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  claimIds: [] as string[],
  policyIds: [] as string[],
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
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.insurancePolicy.deleteMany({
    where: { id: { in: cleanup.policyIds } },
  });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.claimIds = [];
  cleanup.policyIds = [];
  cleanup.incidentIds = [];
  cleanup.vehicleIds = [];
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
// See lib/incidents/incident.integration.test.ts's unique() comment: the
// random suffix guards against cross-file/cross-process collisions on
// globally-unique columns like User.email.
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedOrgWithIncident(incidentDateTime = new Date()) {
  const org = await db.organization.create({
    data: { code: unique("M7"), name: "M7 Test Org" },
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
      incidentDateTime,
      incidentType: "ACCIDENT",
      description: "Test incident.",
    },
  });
  cleanup.incidentIds.push(incident.id);
  return { org, depotA, depotB, vehicle, incident };
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

function track(claimId: string) {
  cleanup.claimIds.push(claimId);
  return claimId;
}

describe("createClaim", () => {
  it("generates CLM-YYYY-###### sequentially within an org/year", async () => {
    const { org, vehicle, incident } = await seedOrgWithIncident();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    void vehicle;

    const claim1 = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    track(claim1.id);
    const claim2 = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "OPERATIONAL",
    });
    track(claim2.id);

    const year = new Date().getFullYear();
    expect(claim1.claimNumber).toMatch(new RegExp(`^CLM-${year}-\\d{6}$`));
    const n1 = Number(claim1.claimNumber.split("-")[2]);
    const n2 = Number(claim2.claimNumber.split("-")[2]);
    expect(n2).toBe(n1 + 1);

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Claim", entityId: claim1.id, action: "CREATE" },
    });
    expect(audit).not.toBeNull();
  });

  it("multiple claims can be filed against the same incident", async () => {
    const { org, incident } = await seedOrgWithIncident();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const claim1 = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    track(claim1.id);
    const claim2 = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "THIRD_PARTY_RECOVERY",
    });
    track(claim2.id);

    expect(claim1.incidentId).toBe(incident.id);
    expect(claim2.incidentId).toBe(incident.id);
  });

  it("BR-05: auto-selects the policy covering the vehicle on the incident date for INSURANCE/MIXED claims", async () => {
    const incidentDateTime = new Date("2026-03-15T10:00:00Z");
    const { org, vehicle, incident } =
      await seedOrgWithIncident(incidentDateTime);
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const policy = await db.insurancePolicy.create({
      data: {
        organizationId: org.id,
        vehicleId: vehicle.id,
        policyNumber: unique("POL"),
        insurerName: "Test Insurer",
        coverageStartDate: new Date("2026-01-01T00:00:00Z"),
        coverageEndDate: new Date("2026-12-31T23:59:59Z"),
      },
    });
    cleanup.policyIds.push(policy.id);
    // A second, non-covering policy period — must NOT be selected.
    const oldPolicy = await db.insurancePolicy.create({
      data: {
        organizationId: org.id,
        vehicleId: vehicle.id,
        policyNumber: unique("POL"),
        insurerName: "Old Insurer",
        coverageStartDate: new Date("2024-01-01T00:00:00Z"),
        coverageEndDate: new Date("2024-12-31T23:59:59Z"),
      },
    });
    cleanup.policyIds.push(oldPolicy.id);

    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "INSURANCE",
    });
    track(claim.id);
    expect(claim.policyId).toBe(policy.id);
  });

  it("leaves policyId null (does not reject) when no policy covers the incident date", async () => {
    const { org, incident } = await seedOrgWithIncident();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "INSURANCE",
    });
    track(claim.id);
    expect(claim.policyId).toBeNull();
  });

  it("does not look up a policy for non-INSURANCE/MIXED claim types", async () => {
    const { org, vehicle, incident } = await seedOrgWithIncident(
      new Date("2026-03-15T10:00:00Z"),
    );
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const policy = await db.insurancePolicy.create({
      data: {
        organizationId: org.id,
        vehicleId: vehicle.id,
        policyNumber: unique("POL"),
        insurerName: "Test Insurer",
        coverageStartDate: new Date("2026-01-01T00:00:00Z"),
        coverageEndDate: new Date("2026-12-31T23:59:59Z"),
      },
    });
    cleanup.policyIds.push(policy.id);

    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    track(claim.id);
    expect(claim.policyId).toBeNull();
  });

  it("CLAIMS_MANAGER can create claims; DEPOT_MANAGER and SURVEYOR cannot", async () => {
    const { org, depotA, incident } = await seedOrgWithIncident();
    const claimsManager = await userSessionWithRole(
      org,
      null,
      "CLAIMS_MANAGER",
    );
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const surveyor = await userSessionWithRole(org, null, "SURVEYOR");

    const claim = await createClaim(claimsManager, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    track(claim.id);
    expect(claim.id).toBeDefined();

    await expect(
      createClaim(managerA, {
        incidentId: incident.id,
        claimType: "MAINTENANCE",
      }),
    ).rejects.toThrow();
    await expect(
      createClaim(surveyor, {
        incidentId: incident.id,
        claimType: "MAINTENANCE",
      }),
    ).rejects.toThrow();
  });
});

describe("updateClaim", () => {
  it("reassigns a claim and records an UPDATE audit entry", async () => {
    const { org, incident } = await seedOrgWithIncident();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const claimsManager = await userSessionWithRole(
      org,
      null,
      "CLAIMS_MANAGER",
    );

    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    track(claim.id);

    const updated = await updateClaim(admin, claim.id, {
      assignedToId: claimsManager.user.id,
    });
    expect(updated.assignedToId).toBe(claimsManager.user.id);

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Claim", entityId: claim.id, action: "UPDATE" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("transitionClaimStatus", () => {
  it("walks the full OPEN -> ... -> CLOSED path and records STATUS_CHANGE audit entries", async () => {
    const { org, incident } = await seedOrgWithIncident();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    track(claim.id);
    expect(claim.status).toBe("OPEN");

    const underSurvey = await transitionClaimStatus(
      admin,
      claim.id,
      "UNDER_SURVEY",
    );
    expect(underSurvey.status).toBe("UNDER_SURVEY");
    const underRepair = await transitionClaimStatus(
      admin,
      claim.id,
      "UNDER_REPAIR",
    );
    expect(underRepair.status).toBe("UNDER_REPAIR");
    const pending = await transitionClaimStatus(
      admin,
      claim.id,
      "PENDING_SETTLEMENT",
    );
    expect(pending.status).toBe("PENDING_SETTLEMENT");
    const settled = await transitionClaimStatus(admin, claim.id, "SETTLED");
    expect(settled.status).toBe("SETTLED");
    const closed = await transitionClaimStatus(admin, claim.id, "CLOSED");
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();

    const statusChanges = await db.auditLog.findMany({
      where: {
        entityType: "Claim",
        entityId: claim.id,
        action: "STATUS_CHANGE",
      },
    });
    expect(statusChanges).toHaveLength(5);
  });

  it("rejects an invalid transition (409) — e.g. OPEN straight to SETTLED, or CLOSED to anything", async () => {
    const { org, incident } = await seedOrgWithIncident();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const claim = await createClaim(admin, {
      incidentId: incident.id,
      claimType: "MAINTENANCE",
    });
    track(claim.id);

    await expect(
      transitionClaimStatus(admin, claim.id, "SETTLED"),
    ).rejects.toThrow(/Cannot transition/);

    await transitionClaimStatus(admin, claim.id, "REJECTED");
    await expect(
      transitionClaimStatus(admin, claim.id, "CLOSED"),
    ).rejects.toThrow(/Cannot transition/);
  });
});

describe("reads", () => {
  it("DEPOT_MANAGER only sees claims on their own depot's incidents; CLAIMS_MANAGER sees the whole org", async () => {
    const {
      org,
      depotA,
      depotB,
      incident: incidentA,
    } = await seedOrgWithIncident();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const claimsManager = await userSessionWithRole(
      org,
      null,
      "CLAIMS_MANAGER",
    );

    const vehicleB = await db.vehicle.create({
      data: {
        organizationId: org.id,
        depotId: depotB.id,
        registrationNumber: unique("VB"),
      },
    });
    cleanup.vehicleIds.push(vehicleB.id);
    const incidentB = await db.incident.create({
      data: {
        organizationId: org.id,
        incidentNumber: unique("INCB"),
        vehicleId: vehicleB.id,
        depotId: depotB.id,
        incidentDateTime: new Date(),
        incidentType: "ACCIDENT",
        description: "Depot B incident.",
      },
    });
    cleanup.incidentIds.push(incidentB.id);

    const claimA = await createClaim(admin, {
      incidentId: incidentA.id,
      claimType: "MAINTENANCE",
    });
    track(claimA.id);
    const claimB = await createClaim(admin, {
      incidentId: incidentB.id,
      claimType: "MAINTENANCE",
    });
    track(claimB.id);

    const asManagerA = await listClaims(managerA);
    expect(asManagerA.map((c) => c.id)).toEqual([claimA.id]);

    const asClaimsManager = await listClaims(claimsManager);
    expect(asClaimsManager.map((c) => c.id).sort()).toEqual(
      [claimA.id, claimB.id].sort(),
    );

    await expect(getClaim(managerA, claimB.id)).rejects.toThrow();
    const readByClaimsManager = await getClaim(claimsManager, claimB.id);
    expect(readByClaimsManager?.id).toBe(claimB.id);
  });
});
