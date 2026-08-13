// Integration tests for the M27 master-data service layer
// (lib/masters/insurer.ts, broker.ts, surveyor.ts, workshop.ts) against
// a real Postgres instance: RBAC (ORG_ADMIN-only writes, any role
// reads), org-scoping, the (organizationId, name) uniqueness
// constraint, Surveyor's linkedUserId validation, and audit logging.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import {
  createInsurer,
  listInsurers,
  updateInsurer,
} from "@/lib/masters/insurer";
import { createBroker, listBrokers } from "@/lib/masters/broker";
import { createSurveyor, updateSurveyor } from "@/lib/masters/surveyor";
import { createWorkshop, listWorkshops } from "@/lib/masters/workshop";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  insurerIds: [] as string[],
  brokerIds: [] as string[],
  surveyorIds: [] as string[],
  workshopIds: [] as string[],
  userIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.insurer.deleteMany({ where: { id: { in: cleanup.insurerIds } } });
  await db.broker.deleteMany({ where: { id: { in: cleanup.brokerIds } } });
  await db.surveyor.deleteMany({ where: { id: { in: cleanup.surveyorIds } } });
  await db.workshop.deleteMany({ where: { id: { in: cleanup.workshopIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.insurerIds = [];
  cleanup.brokerIds = [];
  cleanup.surveyorIds = [];
  cleanup.workshopIds = [];
  cleanup.userIds = [];
  cleanup.orgIds = [];
});

let uniqueCounter = 0;
function unique(label: string) {
  uniqueCounter += 1;
  return `${label}${uniqueCounter}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedOrg() {
  const org = await db.organization.create({
    data: { code: unique("M27"), name: "M27 Test Org" },
  });
  cleanup.orgIds.push(org.id);
  return { org };
}

async function userSessionWithRole(
  org: { id: string },
  role: "ORG_ADMIN" | "CLAIMS_MANAGER",
): Promise<AuthSession> {
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      depotId: null,
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

describe("Insurer", () => {
  it("ORG_ADMIN can create; CLAIMS_MANAGER cannot; any role can list", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    const insurer = await createInsurer(admin, { name: unique("Insurer") });
    cleanup.insurerIds.push(insurer.id);

    await expect(
      createInsurer(claimsManager, { name: unique("Insurer") }),
    ).rejects.toThrow();

    const asClaimsManager = await listInsurers(claimsManager);
    expect(asClaimsManager.map((i) => i.id)).toContain(insurer.id);
  });

  it("rejects a duplicate name within the same org", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const name = unique("Insurer");

    const insurer = await createInsurer(admin, { name });
    cleanup.insurerIds.push(insurer.id);

    await expect(createInsurer(admin, { name })).rejects.toThrow();
  });

  it("updateInsurer records an UPDATE audit entry", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const insurer = await createInsurer(admin, { name: unique("Insurer") });
    cleanup.insurerIds.push(insurer.id);

    const updated = await updateInsurer(admin, insurer.id, {
      name: "Renamed Insurer",
    });
    expect(updated.name).toBe("Renamed Insurer");

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Insurer", entityId: insurer.id, action: "UPDATE" },
    });
    expect(audit).not.toBeNull();
  });

  it("is org-scoped — a second org never sees the first org's insurers", async () => {
    const { org: org1 } = await seedOrg();
    const { org: org2 } = await seedOrg();
    const admin1 = await userSessionWithRole(org1, "ORG_ADMIN");
    const admin2 = await userSessionWithRole(org2, "ORG_ADMIN");

    const insurer1 = await createInsurer(admin1, { name: unique("Insurer") });
    cleanup.insurerIds.push(insurer1.id);

    const asOrg2 = await listInsurers(admin2);
    expect(asOrg2.map((i) => i.id)).not.toContain(insurer1.id);
  });
});

describe("Broker", () => {
  it("ORG_ADMIN can create; CLAIMS_MANAGER cannot", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    const broker = await createBroker(admin, { name: unique("Broker") });
    cleanup.brokerIds.push(broker.id);

    await expect(
      createBroker(claimsManager, { name: unique("Broker") }),
    ).rejects.toThrow();

    const listed = await listBrokers(admin);
    expect(listed.map((b) => b.id)).toContain(broker.id);
  });
});

describe("Surveyor", () => {
  it("creates with a contact and a valid linkedUserId; rejects an invalid linkedUserId", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const internalUser = await db.user.create({
      data: {
        organizationId: org.id,
        name: "Internal Surveyor",
        email: `${unique("internal")}@example.com`,
        role: "SURVEYOR",
      },
    });
    cleanup.userIds.push(internalUser.id);

    const surveyor = await createSurveyor(admin, {
      name: unique("Surveyor"),
      contact: "9800000000",
      linkedUserId: internalUser.id,
    });
    cleanup.surveyorIds.push(surveyor.id);
    expect(surveyor.linkedUserId).toBe(internalUser.id);

    await expect(
      createSurveyor(admin, {
        name: unique("Surveyor"),
        linkedUserId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
  });

  it("updateSurveyor records an UPDATE audit entry", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const surveyor = await createSurveyor(admin, { name: unique("Surveyor") });
    cleanup.surveyorIds.push(surveyor.id);

    await updateSurveyor(admin, surveyor.id, { contact: "9811111111" });

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Surveyor",
        entityId: surveyor.id,
        action: "UPDATE",
      },
    });
    expect(audit).not.toBeNull();
  });
});

describe("Workshop", () => {
  it("creates with contact and address; any role can list", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    const workshop = await createWorkshop(admin, {
      name: unique("Workshop"),
      contact: "9822222222",
      address: "Sector 44, Gurugram",
    });
    cleanup.workshopIds.push(workshop.id);
    expect(workshop.address).toBe("Sector 44, Gurugram");

    const asClaimsManager = await listWorkshops(claimsManager);
    expect(asClaimsManager.map((w) => w.id)).toContain(workshop.id);
  });
});
