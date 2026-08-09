// Integration tests for the M4 masters service layer (lib/masters/*)
// against a real Postgres instance: RBAC (who can write what), depot-
// scoping (DEPOT_MANAGER confined to their own depot), the cross-depot
// transfer restriction, and BR-08 audit logging.
//
// Sessions are faked (a plain object shaped like AuthSession) rather than
// going through real login — session mechanics are already covered by
// lib/auth.integration.test.ts; these tests are about the masters
// business logic, not auth plumbing.
//
// forbidden()/unauthorized() need __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set
// by hand outside Next's own runtime — see lib/dal.test.ts for why.
//
// Requires DATABASE_URL.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createCity, listCities, updateCity } from "@/lib/masters/city";
import { createDepot, listDepots } from "@/lib/masters/depot";
import {
  archiveVehicle,
  createVehicle,
  listVehicles,
  updateVehicle,
} from "@/lib/masters/vehicle";
import { createDriver, listDrivers } from "@/lib/masters/driver";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
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
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.driver.deleteMany({ where: { id: { in: cleanup.driverIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.vehicleIds = [];
  cleanup.driverIds = [];
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
function unique(label: string) {
  uniqueCounter += 1;
  // Short on purpose — registrationNumber/licenseNumber/depot code all
  // have real max-length limits (see lib/masters/*.ts), unlike a
  // timestamp-based suffix.
  return `${label}${uniqueCounter}`;
}

async function seedOrgWithTwoDepots() {
  const org = await db.organization.create({
    data: { code: unique("M4"), name: "M4 Test Org" },
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
  return { org, city, depotA, depotB };
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
  // Shaped like getActiveDbSession()'s return value (Session & { user: User })
  // without a real Session row — see file header.
  return {
    id: "fake-session",
    userId: user.id,
    expiresAt: new Date(Date.now() + 100_000),
    revokedAt: null,
    createdAt: new Date(),
    user,
  } as AuthSession;
}

describe("City", () => {
  it("ORG_ADMIN can create a city; DEPOT_MANAGER cannot", async () => {
    const { org, depotA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const city = await createCity(admin, {
      name: "Faridabad",
      state: "Haryana",
    });
    cleanup.cityIds.push(city.id);
    expect(city.name).toBe("Faridabad");

    await expect(createCity(manager, { name: "Noida" })).rejects.toThrow();
  });

  it("any authenticated role can list cities", async () => {
    // seedOrgWithTwoDepots already creates one city (needed for the
    // depots); this adds a second to confirm listCities sees both.
    const { org, depotA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const city = await createCity(admin, { name: "Faridabad" });
    cleanup.cityIds.push(city.id);

    const asManager = await listCities(manager);
    expect(asManager).toHaveLength(2);
  });

  it("records CREATE and UPDATE audit entries", async () => {
    const { org } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const city = await createCity(admin, { name: "Faridabad" });
    cleanup.cityIds.push(city.id);
    await updateCity(admin, city.id, { state: "Haryana" });

    const entries = await db.auditLog.findMany({
      where: { entityType: "City", entityId: city.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => e.action)).toEqual(["CREATE", "UPDATE"]);
  });

  it("rejects an empty name", async () => {
    const { org } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    await expect(createCity(admin, { name: "" })).rejects.toThrow(ZodError);
  });
});

describe("Depot", () => {
  it("ORG_ADMIN can create a depot; DEPOT_MANAGER cannot", async () => {
    const { org, city, depotA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const depot = await createDepot(admin, {
      cityId: city.id,
      code: unique("DC"),
      name: "Depot C",
    });
    cleanup.depotIds.push(depot.id);

    await expect(
      createDepot(manager, {
        cityId: city.id,
        code: unique("DD"),
        name: "Depot D",
      }),
    ).rejects.toThrow();
  });

  it("DEPOT_MANAGER only lists their own depot; ORG_ADMIN lists all", async () => {
    const { org, depotA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const asManager = await listDepots(manager);
    expect(asManager.map((d) => d.id)).toEqual([depotA.id]);

    const asAdmin = await listDepots(admin);
    expect(asAdmin).toHaveLength(2);
  });
});

describe("Vehicle", () => {
  it("DEPOT_MANAGER can create a vehicle in their own depot, not another depot", async () => {
    const { org, depotA, depotB } = await seedOrgWithTwoDepots();
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const vehicle = await createVehicle(manager, {
      depotId: depotA.id,
      registrationNumber: unique("HR55"),
    });
    cleanup.vehicleIds.push(vehicle.id);

    await expect(
      createVehicle(manager, {
        depotId: depotB.id,
        registrationNumber: unique("HR56"),
      }),
    ).rejects.toThrow();
  });

  it("normalizes the registration number to uppercase", async () => {
    const { org, depotA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const vehicle = await createVehicle(admin, {
      depotId: depotA.id,
      registrationNumber: "hr55ab1234",
    });
    cleanup.vehicleIds.push(vehicle.id);
    expect(vehicle.registrationNumber).toBe("HR55AB1234");
  });

  it("DEPOT_MANAGER only lists vehicles in their own depot", async () => {
    const { org, depotA, depotB } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const vA = await createVehicle(admin, {
      depotId: depotA.id,
      registrationNumber: unique("A"),
    });
    const vB = await createVehicle(admin, {
      depotId: depotB.id,
      registrationNumber: unique("B"),
    });
    cleanup.vehicleIds.push(vA.id, vB.id);

    const asManager = await listVehicles(manager);
    expect(asManager.map((v) => v.id)).toEqual([vA.id]);
  });

  it("DEPOT_MANAGER cannot update a vehicle in another depot", async () => {
    const { org, depotA, depotB } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const vB = await createVehicle(admin, {
      depotId: depotB.id,
      registrationNumber: unique("B"),
    });
    cleanup.vehicleIds.push(vB.id);

    await expect(
      updateVehicle(managerA, vB.id, { make: "Tata" }),
    ).rejects.toThrow();
  });

  it("DEPOT_MANAGER cannot transfer a vehicle to another depot; ORG_ADMIN can", async () => {
    const { org, depotA, depotB } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const vehicle = await createVehicle(admin, {
      depotId: depotA.id,
      registrationNumber: unique("XFER"),
    });
    cleanup.vehicleIds.push(vehicle.id);

    await expect(
      updateVehicle(managerA, vehicle.id, { depotId: depotB.id }),
    ).rejects.toThrow();

    const transferred = await updateVehicle(admin, vehicle.id, {
      depotId: depotB.id,
    });
    expect(transferred.depotId).toBe(depotB.id);
  });

  it("archiveVehicle sets status INACTIVE and records a STATUS_CHANGE audit entry", async () => {
    const { org, depotA } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const vehicle = await createVehicle(admin, {
      depotId: depotA.id,
      registrationNumber: unique("ARCH"),
    });
    cleanup.vehicleIds.push(vehicle.id);

    const archived = await archiveVehicle(admin, vehicle.id);
    expect(archived.status).toBe("INACTIVE");

    const entry = await db.auditLog.findFirst({
      where: {
        entityType: "Vehicle",
        entityId: vehicle.id,
        action: "STATUS_CHANGE",
      },
    });
    expect(entry).not.toBeNull();
  });
});

describe("Driver", () => {
  it("DEPOT_MANAGER can create a driver in their own depot, not another depot", async () => {
    const { org, depotA, depotB } = await seedOrgWithTwoDepots();
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const driver = await createDriver(manager, {
      depotId: depotA.id,
      name: "Test Driver",
      licenseNumber: unique("DL"),
    });
    cleanup.driverIds.push(driver.id);

    await expect(
      createDriver(manager, {
        depotId: depotB.id,
        name: "Other Driver",
        licenseNumber: unique("DL"),
      }),
    ).rejects.toThrow();
  });

  it("DEPOT_MANAGER only lists drivers in their own depot", async () => {
    const { org, depotA, depotB } = await seedOrgWithTwoDepots();
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
    const manager = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const dA = await createDriver(admin, {
      depotId: depotA.id,
      name: "Driver A",
      licenseNumber: unique("DL"),
    });
    const dB = await createDriver(admin, {
      depotId: depotB.id,
      name: "Driver B",
      licenseNumber: unique("DL"),
    });
    cleanup.driverIds.push(dA.id, dB.id);

    const asManager = await listDrivers(manager);
    expect(asManager.map((d) => d.id)).toEqual([dA.id]);
  });

  it("a role with no write access (CLAIMS_MANAGER) cannot create a driver", async () => {
    const { org, depotA } = await seedOrgWithTwoDepots();
    const claimsManager = await userSessionWithRole(
      org,
      depotA.id,
      "CLAIMS_MANAGER",
    );

    await expect(
      createDriver(claimsManager, {
        depotId: depotA.id,
        name: "Nope",
        licenseNumber: unique("DL"),
      }),
    ).rejects.toThrow();
  });
});
