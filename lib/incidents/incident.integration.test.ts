// Integration tests for the M6 incident service (lib/incidents/incident.ts)
// against a real Postgres instance: RBAC, depot-scoping, human-readable ID
// generation, and status transitions.
//
// Sessions are faked, same as lib/masters/masters.integration.test.ts —
// see that file's header for why.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import {
  closeIncident,
  createIncident,
  getIncident,
  listIncidents,
  reopenIncident,
  updateIncident,
} from "@/lib/incidents/incident";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  incidentIds: [] as string[],
  vehicleIds: [] as string[],
  driverIds: [] as string[],
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
  await db.evidence.deleteMany({
    where: { incidentId: { in: cleanup.incidentIds } },
  });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.driver.deleteMany({ where: { id: { in: cleanup.driverIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.incidentIds = [];
  cleanup.vehicleIds = [];
  cleanup.driverIds = [];
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
// The counter alone isn't enough: multiple integration test files can run
// concurrently against the same shared Postgres, each with its own
// uniqueCounter starting at 0 — e.g. this file's "ORG_ADMIN1@example.com"
// colliding with another file's identical string on User.email's *global*
// unique constraint. The random suffix makes cross-file/cross-process
// collisions astronomically unlikely while staying short enough for
// length-constrained fields (registrationNumber, licenseNumber, ...).
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedOrgWithTwoDepotsAndVehicles() {
  const org = await db.organization.create({
    data: { code: unique("M6"), name: "M6 Test Org" },
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
  const driverA = await db.driver.create({
    data: {
      organizationId: org.id,
      depotId: depotA.id,
      name: "Driver A",
      licenseNumber: unique("DL"),
    },
  });
  cleanup.driverIds.push(driverA.id);
  return { org, depotA, depotB, vehicleA, vehicleB, driverA };
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

function track(incidentId: string) {
  cleanup.incidentIds.push(incidentId);
  return incidentId;
}

describe("createIncident", () => {
  it("generates INC-YYYY-###### sequentially within an org/year, and inherits the vehicle's depot", async () => {
    const { org, vehicleA, driverA, depotA } =
      await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const incident1 = await createIncident(admin, {
      vehicleId: vehicleA.id,
      driverId: driverA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Minor collision.",
    });
    track(incident1.id);
    const incident2 = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "BREAKDOWN",
      description: "Engine trouble.",
    });
    track(incident2.id);

    const year = new Date().getFullYear();
    expect(incident1.incidentNumber).toMatch(
      new RegExp(`^INC-${year}-\\d{6}$`),
    );
    const n1 = Number(incident1.incidentNumber.split("-")[2]);
    const n2 = Number(incident2.incidentNumber.split("-")[2]);
    expect(n2).toBe(n1 + 1);
    expect(incident1.depotId).toBe(depotA.id);

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Incident",
        entityId: incident1.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("DEPOT_MANAGER can create for their own depot's vehicle, not another depot's", async () => {
    const { org, depotA, vehicleA, vehicleB } =
      await seedOrgWithTwoDepotsAndVehicles();
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const incident = await createIncident(managerA, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Own depot.",
    });
    track(incident.id);
    expect(incident.id).toBeDefined();

    await expect(
      createIncident(managerA, {
        vehicleId: vehicleB.id,
        incidentDateTime: new Date(),
        incidentType: "ACCIDENT",
        description: "Other depot.",
      }),
    ).rejects.toThrow();
  });

  it("a role with no write access (CLAIMS_MANAGER) cannot create an incident", async () => {
    const { org, depotA, vehicleA } = await seedOrgWithTwoDepotsAndVehicles();
    const claimsManager = await userSessionWithRole(
      org,
      depotA.id,
      "CLAIMS_MANAGER",
    );

    await expect(
      createIncident(claimsManager, {
        vehicleId: vehicleA.id,
        incidentDateTime: new Date(),
        incidentType: "ACCIDENT",
        description: "Nope.",
      }),
    ).rejects.toThrow();
  });
});

describe("updateIncident", () => {
  it("records an UPDATE audit entry and rejects a DEPOT_MANAGER editing another depot's incident", async () => {
    const { org, depotA, vehicleB } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const incident = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Original.",
    });
    track(incident.id);

    await updateIncident(admin, incident.id, {
      description: "Corrected description.",
    });
    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Incident",
        entityId: incident.id,
        action: "UPDATE",
      },
    });
    expect(audit).not.toBeNull();

    await expect(
      updateIncident(managerA, incident.id, {
        description: "Should not be allowed.",
      }),
    ).rejects.toThrow();
  });

  it("M21: sets injuries/thirdPartyInvolved, both optional and independently updatable", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const incident = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Test.",
    });
    track(incident.id);
    expect(incident.injuries).toBeNull();
    expect(incident.thirdPartyInvolved).toBeNull();

    const updated = await updateIncident(admin, incident.id, {
      injuries: "Minor bruising, driver, treated on-site.",
      thirdPartyInvolved: true,
    });
    expect(updated.injuries).toBe(
      "Minor bruising, driver, treated on-site.",
    );
    expect(updated.thirdPartyInvolved).toBe(true);
  });
});

describe("close/reopen", () => {
  it("transitions OPEN -> CLOSED -> OPEN, records STATUS_CHANGE audit entries, and rejects a double-close", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const incident = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Test.",
    });
    track(incident.id);
    expect(incident.status).toBe("OPEN");

    const closed = await closeIncident(admin, incident.id);
    expect(closed.status).toBe("CLOSED");

    await expect(closeIncident(admin, incident.id)).rejects.toThrow(
      /already closed/,
    );

    const reopened = await reopenIncident(admin, incident.id);
    expect(reopened.status).toBe("OPEN");

    const statusChanges = await db.auditLog.findMany({
      where: {
        entityType: "Incident",
        entityId: incident.id,
        action: "STATUS_CHANGE",
      },
    });
    expect(statusChanges).toHaveLength(2);
  });
});

describe("reads", () => {
  it("DEPOT_MANAGER cannot read another depot's incident; other roles can", async () => {
    const { org, depotA, vehicleB } = await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const claimsManager = await userSessionWithRole(
      org,
      depotA.id,
      "CLAIMS_MANAGER",
    );

    const incident = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Depot B incident.",
    });
    track(incident.id);

    await expect(getIncident(managerA, incident.id)).rejects.toThrow();
    const asClaimsManager = await getIncident(claimsManager, incident.id);
    expect(asClaimsManager?.id).toBe(incident.id);
  });

  it("listIncidents scopes to the DEPOT_MANAGER's own depot and supports a status filter", async () => {
    const { org, depotA, vehicleA, vehicleB } =
      await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const incidentA = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "A",
    });
    track(incidentA.id);
    const incidentB = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "B",
    });
    track(incidentB.id);
    await closeIncident(admin, incidentA.id);

    const asManagerA = await listIncidents(managerA);
    expect(asManagerA.map((i) => i.id)).toEqual([incidentA.id]);

    const openOnly = await listIncidents(admin, { status: "OPEN" });
    expect(openOnly.map((i) => i.id)).toEqual([incidentB.id]);
  });

  it("M21: filters by severity/incidentType/depotId/date range; a DEPOT_MANAGER filtering by another depot gets an empty list, not a bypass", async () => {
    const { org, depotA, depotB, vehicleA, vehicleB } =
      await seedOrgWithTwoDepotsAndVehicles();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const incidentA = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date("2026-01-15"),
      incidentType: "ACCIDENT",
      severity: "HIGH",
      description: "A",
    });
    track(incidentA.id);
    const incidentB = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date("2026-06-01"),
      incidentType: "THEFT",
      severity: "LOW",
      description: "B",
    });
    track(incidentB.id);

    expect(
      (await listIncidents(admin, { severity: "HIGH" })).map((i) => i.id),
    ).toEqual([incidentA.id]);
    expect(
      (await listIncidents(admin, { incidentType: "THEFT" })).map(
        (i) => i.id,
      ),
    ).toEqual([incidentB.id]);
    expect(
      (await listIncidents(admin, { depotId: depotB.id })).map((i) => i.id),
    ).toEqual([incidentB.id]);
    expect(
      (
        await listIncidents(admin, {
          dateFrom: new Date("2026-01-01"),
          dateTo: new Date("2026-03-01"),
        })
      ).map((i) => i.id),
    ).toEqual([incidentA.id]);

    // depotA is managerA's own scope — asking for depotB explicitly
    // doesn't leak depotB's data, it's just empty.
    expect(await listIncidents(managerA, { depotId: depotB.id })).toEqual([]);
  });
});
