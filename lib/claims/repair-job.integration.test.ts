// Integration tests for the M7 repair-job service (lib/claims/repair-job.ts)
// against a real Postgres instance: RBAC, depot-scoping through the parent
// claim/incident, the RepairJobStatus transition map, and workshop
// activity logging (which resolves access through RepairJob -> Claim ->
// Incident, the same pattern as M6's Evidence org-scoping fix — see
// docs/CLAIMS.md).
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createClaim } from "@/lib/claims/claim";
import {
  addWorkshopActivity,
  createRepairJob,
  listRepairJobsForClaim,
  transitionRepairJobStatus,
  updateRepairJob,
} from "@/lib/claims/repair-job";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
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
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.idCounter.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.workshopActivity.deleteMany({
    where: { repairJobId: { in: cleanup.repairJobIds } },
  });
  await db.repairJob.deleteMany({
    where: { id: { in: cleanup.repairJobIds } },
  });
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
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

async function seedOrgWithClaim() {
  const org = await db.organization.create({
    data: { code: unique("M7R"), name: "M7 Repair Test Org" },
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
      description: "Test incident.",
    },
  });
  cleanup.incidentIds.push(incident.id);
  const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
  const claim = await createClaim(admin, {
    incidentId: incident.id,
    claimType: "MAINTENANCE",
  });
  cleanup.claimIds.push(claim.id);
  return { org, depotA, depotB, claim, admin };
}

async function userSessionWithRole(
  org: { id: string },
  depotId: string | null,
  role:
    "ORG_ADMIN" | "DEPOT_MANAGER" | "CLAIMS_MANAGER" | "WORKSHOP_COORDINATOR",
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

function track(repairJobId: string) {
  cleanup.repairJobIds.push(repairJobId);
  return repairJobId;
}

describe("createRepairJob", () => {
  it("creates a repair job with a default INR currency and records a CREATE audit entry", async () => {
    const { claim, admin } = await seedOrgWithClaim();

    const repairJob = await createRepairJob(admin, {
      claimId: claim.id,
      workshopName: "ACME Motors",
      estimatedCost: 15000,
    });
    track(repairJob.id);
    expect(repairJob.currency).toBe("INR");
    expect(repairJob.status).toBe("ESTIMATE_PENDING");

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "RepairJob",
        entityId: repairJob.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("WORKSHOP_COORDINATOR can create repair jobs; DEPOT_MANAGER cannot", async () => {
    const { org, depotA, claim } = await seedOrgWithClaim();
    const coordinator = await userSessionWithRole(
      org,
      null,
      "WORKSHOP_COORDINATOR",
    );
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const repairJob = await createRepairJob(coordinator, {
      claimId: claim.id,
      workshopName: "Coordinator Workshop",
    });
    track(repairJob.id);
    expect(repairJob.id).toBeDefined();

    await expect(
      createRepairJob(managerA, {
        claimId: claim.id,
        workshopName: "Should fail",
      }),
    ).rejects.toThrow();
  });
});

describe("updateRepairJob", () => {
  it("updates cost fields and records an UPDATE audit entry", async () => {
    const { claim, admin } = await seedOrgWithClaim();
    const repairJob = await createRepairJob(admin, {
      claimId: claim.id,
      workshopName: "ACME Motors",
      estimatedCost: 10000,
    });
    track(repairJob.id);

    const updated = await updateRepairJob(admin, repairJob.id, {
      approvedCost: 9500,
    });
    expect(Number(updated.approvedCost)).toBe(9500);

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "RepairJob",
        entityId: repairJob.id,
        action: "UPDATE",
      },
    });
    expect(audit).not.toBeNull();
  });
});

describe("transitionRepairJobStatus", () => {
  it("walks ESTIMATE_PENDING -> APPROVED -> IN_PROGRESS -> COMPLETED", async () => {
    const { claim, admin } = await seedOrgWithClaim();
    const repairJob = await createRepairJob(admin, {
      claimId: claim.id,
      workshopName: "ACME Motors",
    });
    track(repairJob.id);

    const approved = await transitionRepairJobStatus(
      admin,
      repairJob.id,
      "APPROVED",
    );
    expect(approved.status).toBe("APPROVED");
    const inProgress = await transitionRepairJobStatus(
      admin,
      repairJob.id,
      "IN_PROGRESS",
    );
    expect(inProgress.status).toBe("IN_PROGRESS");
    const completed = await transitionRepairJobStatus(
      admin,
      repairJob.id,
      "COMPLETED",
    );
    expect(completed.status).toBe("COMPLETED");
  });

  it("rejects skipping a stage (409) — e.g. ESTIMATE_PENDING straight to COMPLETED", async () => {
    const { claim, admin } = await seedOrgWithClaim();
    const repairJob = await createRepairJob(admin, {
      claimId: claim.id,
      workshopName: "ACME Motors",
    });
    track(repairJob.id);

    await expect(
      transitionRepairJobStatus(admin, repairJob.id, "COMPLETED"),
    ).rejects.toThrow(/Cannot transition/);
  });
});

describe("addWorkshopActivity", () => {
  it("logs an activity against the repair job, scoped through its parent claim/incident", async () => {
    const { claim, admin } = await seedOrgWithClaim();
    const repairJob = await createRepairJob(admin, {
      claimId: claim.id,
      workshopName: "ACME Motors",
    });
    track(repairJob.id);

    const activity = await addWorkshopActivity(admin, repairJob.id, {
      activityType: "ESTIMATE_SUBMITTED",
      notes: "Initial estimate received.",
    });
    expect(activity.repairJobId).toBe(repairJob.id);
    expect(activity.actorId).toBe(admin.user.id);

    const fetched = await db.workshopActivity.findMany({
      where: { repairJobId: repairJob.id },
    });
    expect(fetched).toHaveLength(1);
  });

  it("rejects a DEPOT_MANAGER from a different depot logging an activity", async () => {
    const { depotB, org, claim, admin } = await seedOrgWithClaim();
    const repairJob = await createRepairJob(admin, {
      claimId: claim.id,
      workshopName: "ACME Motors",
    });
    track(repairJob.id);
    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");

    await expect(
      addWorkshopActivity(managerB, repairJob.id, {
        activityType: "QC_CHECK",
      }),
    ).rejects.toThrow();
  });
});

describe("listRepairJobsForClaim", () => {
  it("is depot-scoped for DEPOT_MANAGER via the claim's incident", async () => {
    const { org, depotA, depotB, claim, admin } = await seedOrgWithClaim();
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");

    const repairJob = await createRepairJob(admin, {
      claimId: claim.id,
      workshopName: "ACME Motors",
    });
    track(repairJob.id);

    const asManagerA = await listRepairJobsForClaim(managerA, claim.id);
    expect(asManagerA.map((r) => r.id)).toEqual([repairJob.id]);

    await expect(listRepairJobsForClaim(managerB, claim.id)).rejects.toThrow();
  });
});
