// Integration test for scopedDb() against a real Postgres instance.
// Interactive transaction clients don't support .$extends() (verified
// empirically — see docs/AUTH.md), so this can't use the
// rollback-transaction pattern the other integration tests use. Instead it
// creates real rows via the plain `db` client and cleans them up in a
// `finally` block, in FK-safe order.
//
// Requires DATABASE_URL to point at a running Postgres.
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";

const cleanupIds: {
  vehicles: string[];
  depots: string[];
  cities: string[];
  orgs: string[];
} = {
  vehicles: [],
  depots: [],
  cities: [],
  orgs: [],
};

afterEach(async () => {
  await db.vehicle.deleteMany({ where: { id: { in: cleanupIds.vehicles } } });
  await db.depot.deleteMany({ where: { id: { in: cleanupIds.depots } } });
  await db.city.deleteMany({ where: { id: { in: cleanupIds.cities } } });
  await db.organization.deleteMany({ where: { id: { in: cleanupIds.orgs } } });
  cleanupIds.vehicles = [];
  cleanupIds.depots = [];
  cleanupIds.cities = [];
  cleanupIds.orgs = [];
});

async function seedOrgWithVehicle(label: string) {
  const org = await db.organization.create({
    data: {
      code: `SCOPED-${label}-${Date.now()}-${Math.random()}`,
      name: `Org ${label}`,
    },
  });
  cleanupIds.orgs.push(org.id);

  const city = await db.city.create({
    data: { organizationId: org.id, name: "City" },
  });
  cleanupIds.cities.push(city.id);

  const depot = await db.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: `D-${label}`,
      name: `Depot ${label}`,
    },
  });
  cleanupIds.depots.push(depot.id);

  const vehicle = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depot.id,
      registrationNumber: `REG-${label}-${Math.floor(Math.random() * 100000)}`,
    },
  });
  cleanupIds.vehicles.push(vehicle.id);

  return { org, depot, vehicle };
}

describe("scopedDb", () => {
  it("only returns rows for the scoped organization on findMany", async () => {
    const { org: orgA, vehicle: vehicleA } = await seedOrgWithVehicle("A");
    const { vehicle: vehicleB } = await seedOrgWithVehicle("B");

    const scoped = scopedDb(orgA.id);
    const vehicles = await scoped.vehicle.findMany({
      where: { id: { in: [vehicleA.id, vehicleB.id] } },
    });

    expect(vehicles.map((v) => v.id)).toEqual([vehicleA.id]);
  });

  it("returns null (not another org's row) on findUnique across orgs", async () => {
    const { org: orgA } = await seedOrgWithVehicle("A");
    const { vehicle: vehicleB } = await seedOrgWithVehicle("B");

    const scoped = scopedDb(orgA.id);
    const result = await scoped.vehicle.findUnique({
      where: { id: vehicleB.id },
    });

    expect(result).toBeNull();
  });

  it("fails (not silently no-ops) an update targeting another org's row", async () => {
    const { org: orgA } = await seedOrgWithVehicle("A");
    const { vehicle: vehicleB } = await seedOrgWithVehicle("B");

    const scoped = scopedDb(orgA.id);

    await expect(
      scoped.vehicle.update({
        where: { id: vehicleB.id },
        data: { make: "Should not apply" },
      }),
    ).rejects.toThrow();

    const stillUnchanged = await db.vehicle.findUniqueOrThrow({
      where: { id: vehicleB.id },
    });
    expect(stillUnchanged.make).toBeNull();
  });

  it("does not affect models with no organizationId column (e.g. Session)", async () => {
    const { org: orgA } = await seedOrgWithVehicle("A");
    const scoped = scopedDb(orgA.id);
    // Session has no organizationId column — scopedDb must pass this
    // through untouched rather than injecting a bogus filter that would
    // throw a Prisma validation error.
    await expect(
      scoped.session.findMany({ where: { id: "does-not-exist" } }),
    ).resolves.toEqual([]);
  });
});
