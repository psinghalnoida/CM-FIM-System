// Integration test for M28's getVehicleHistory (lib/masters/vehicle.ts)
// against a real Postgres instance: a vehicle's incidents/claims/repair
// jobs are all found, correctly, without needing lib/incidents/
// incident.ts's own ListIncidentsFilter to grow a vehicleId option.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { getVehicleHistory } from "@/lib/masters/vehicle";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim } from "@/lib/claims/claim";
import { createRepairJob } from "@/lib/claims/repair-job";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  repairJobIds: [] as string[],
  workshopIds: [] as string[],
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
  await db.repairJob.deleteMany({ where: { id: { in: cleanup.repairJobIds } } });
  await db.workshop.deleteMany({ where: { id: { in: cleanup.workshopIds } } });
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.repairJobIds = [];
  cleanup.workshopIds = [];
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
  role: "ORG_ADMIN",
): Promise<AuthSession> {
  const user = await db.user.create({
    data: {
      organizationId: org.id,
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

describe("getVehicleHistory (M28)", () => {
  it("returns exactly this vehicle's incidents, claims, and repair jobs — none of a second vehicle's", async () => {
    const org = await db.organization.create({
      data: { code: unique("M28H"), name: "M28 History Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const city = await db.city.create({
      data: { organizationId: org.id, name: "City" },
    });
    cleanup.cityIds.push(city.id);
    const depot = await db.depot.create({
      data: { organizationId: org.id, cityId: city.id, code: unique("D"), name: "Depot" },
    });
    cleanup.depotIds.push(depot.id);
    const vehicleA = await db.vehicle.create({
      data: { organizationId: org.id, depotId: depot.id, registrationNumber: unique("VA") },
    });
    const vehicleB = await db.vehicle.create({
      data: { organizationId: org.id, depotId: depot.id, registrationNumber: unique("VB") },
    });
    cleanup.vehicleIds.push(vehicleA.id, vehicleB.id);
    const admin = await userSessionWithRole(org, "ORG_ADMIN");

    const incidentA = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M28 vehicle history test — vehicle A.",
    });
    cleanup.incidentIds.push(incidentA.id);
    const claimA = await createClaim(admin, {
      incidentId: incidentA.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(claimA.id);
    const workshop = await db.workshop.create({
      data: { organizationId: org.id, name: unique("Workshop") },
    });
    cleanup.workshopIds.push(workshop.id);
    const repairJobA = await createRepairJob(admin, {
      claimId: claimA.id,
      workshopId: workshop.id,
    });
    cleanup.repairJobIds.push(repairJobA.id);

    // A second vehicle's own incident — must never show up in vehicleA's history.
    const incidentB = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "BREAKDOWN",
      description: "M28 vehicle history test — vehicle B.",
    });
    cleanup.incidentIds.push(incidentB.id);

    const history = await getVehicleHistory(admin, vehicleA.id);
    expect(history.incidents.map((i) => i.id)).toEqual([incidentA.id]);
    expect(history.claims.map((c) => c.id)).toEqual([claimA.id]);
    expect(history.claims[0].incident.id).toBe(incidentA.id);
    expect(history.repairJobs.map((r) => r.id)).toEqual([repairJobA.id]);
    expect(history.repairJobs[0].workshop.id).toBe(workshop.id);

    const historyB = await getVehicleHistory(admin, vehicleB.id);
    expect(historyB.incidents.map((i) => i.id)).toEqual([incidentB.id]);
    expect(historyB.claims).toEqual([]);
    expect(historyB.repairJobs).toEqual([]);
  });
});
