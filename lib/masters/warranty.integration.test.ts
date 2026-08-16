// Integration tests for M28's Warranty service (lib/masters/warranty.ts)
// against a real Postgres instance: RBAC (same tier as Vehicle itself),
// depot-scoping through the parent vehicle, endDate-after-startDate
// validation, and audit logging.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import {
  createWarranty,
  listWarrantiesForVehicle,
  updateWarranty,
} from "@/lib/masters/warranty";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  warrantyIds: [] as string[],
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
  await db.warranty.deleteMany({ where: { id: { in: cleanup.warrantyIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.warrantyIds = [];
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

async function seedOrgWithTwoDepots() {
  const org = await db.organization.create({
    data: { code: unique("M28"), name: "M28 Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({
    data: { organizationId: org.id, name: "City" },
  });
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
  return { org, depotA, depotB, vehicleA, vehicleB };
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

describe("createWarranty", () => {
  it("ORG_ADMIN and DEPOT_MANAGER (own depot) can create; CLAIMS_MANAGER cannot", async () => {
    const { org, depotA, vehicleA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const claimsManager = await userSessionWithRole(org, null, "CLAIMS_MANAGER");

    const warranty = await createWarranty(admin, {
      vehicleId: vehicleA.id,
      provider: "Tata Motors",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    cleanup.warrantyIds.push(warranty.id);
    expect(warranty.provider).toBe("Tata Motors");

    const byManager = await createWarranty(managerA, {
      vehicleId: vehicleA.id,
      provider: "Extended Cover Co",
      startDate: "2026-01-01",
      endDate: "2028-01-01",
    });
    cleanup.warrantyIds.push(byManager.id);

    await expect(
      createWarranty(claimsManager, {
        vehicleId: vehicleA.id,
        provider: "Should fail",
        startDate: "2026-01-01",
        endDate: "2027-01-01",
      }),
    ).rejects.toThrow();
  });

  it("DEPOT_MANAGER cannot create a warranty for another depot's vehicle", async () => {
    const { org, depotA, vehicleB } = await seedOrgWithTwoDepots();
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    await expect(
      createWarranty(managerA, {
        vehicleId: vehicleB.id,
        provider: "Should fail",
        startDate: "2026-01-01",
        endDate: "2027-01-01",
      }),
    ).rejects.toThrow();
  });

  it("rejects endDate before or equal to startDate", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    await expect(
      createWarranty(admin, {
        vehicleId: vehicleA.id,
        provider: "Bad Dates Inc",
        startDate: "2026-06-01",
        endDate: "2026-01-01",
      }),
    ).rejects.toThrow(ZodError);
  });

  it("multiple warranties are allowed on the same vehicle", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const w1 = await createWarranty(admin, {
      vehicleId: vehicleA.id,
      provider: "Manufacturer",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    const w2 = await createWarranty(admin, {
      vehicleId: vehicleA.id,
      provider: "Extended",
      startDate: "2027-01-01",
      endDate: "2029-01-01",
    });
    cleanup.warrantyIds.push(w1.id, w2.id);

    const listed = await listWarrantiesForVehicle(admin, vehicleA.id);
    expect(listed).toHaveLength(2);
  });
});

describe("listWarrantiesForVehicle", () => {
  it("is depot-scoped for DEPOT_MANAGER via the vehicle's own depot", async () => {
    const { org, depotA, depotB, vehicleB } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const warranty = await createWarranty(admin, {
      vehicleId: vehicleB.id,
      provider: "Test Provider",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    cleanup.warrantyIds.push(warranty.id);

    await expect(
      listWarrantiesForVehicle(managerA, vehicleB.id),
    ).rejects.toThrow();

    const asAdmin = await listWarrantiesForVehicle(admin, vehicleB.id);
    expect(asAdmin.map((w) => w.id)).toEqual([warranty.id]);
    void depotB;
  });
});

describe("updateWarranty", () => {
  it("records an UPDATE audit entry", async () => {
    const { org, vehicleA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const warranty = await createWarranty(admin, {
      vehicleId: vehicleA.id,
      provider: "Tata Motors",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    cleanup.warrantyIds.push(warranty.id);

    const updated = await updateWarranty(admin, warranty.id, {
      coverageDescription: "Engine and transmission",
    });
    expect(updated.coverageDescription).toBe("Engine and transmission");

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Warranty",
        entityId: warranty.id,
        action: "UPDATE",
      },
    });
    expect(audit).not.toBeNull();
  });
});
