// Integration tests for the M18 user-management service
// (lib/admin/user.ts) against a real Postgres instance: RBAC, password
// redaction, the DEPOT_MANAGER-requires-depotId guard, the
// self-deactivation lock, and audit logging.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  updateUser,
} from "@/lib/admin/user";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  userIds: [] as string[],
  depotIds: [] as string[],
  cityIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
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
  role: "ORG_ADMIN" | "CLAIMS_MANAGER",
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

async function seedOrgWithDepot() {
  const org = await db.organization.create({
    data: { code: unique("M18"), name: "M18 Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({
    data: { organizationId: org.id, name: "City" },
  });
  cleanup.cityIds.push(city.id);
  const depot = await db.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: unique("D"),
      name: "Depot",
    },
  });
  cleanup.depotIds.push(depot.id);
  const admin = await userSessionWithRole(org, "ORG_ADMIN");
  return { org, depot, admin };
}

function track(id: string) {
  cleanup.userIds.push(id);
  return id;
}

describe("createUser", () => {
  it("ORG_ADMIN can create a user; the response and audit entry never carry passwordHash", async () => {
    const { admin } = await seedOrgWithDepot();

    const user = await createUser(admin, {
      name: "Finance Person",
      email: `${unique("finance")}@example.com`,
      role: "FINANCE_OFFICER",
      password: "a-real-password",
    });
    track(user.id);

    expect(user).not.toHaveProperty("passwordHash");
    expect(user.status).toBe("ACTIVE");

    const audit = await db.auditLog.findFirst({
      where: { entityType: "User", entityId: user.id, action: "CREATE" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.afterData)).not.toContain("passwordHash");
  });

  it("CLAIMS_MANAGER cannot create a user", async () => {
    const { org } = await seedOrgWithDepot();
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    await expect(
      createUser(claimsManager, {
        name: "Nope",
        email: `${unique("nope")}@example.com`,
        role: "SURVEYOR",
        password: "a-real-password",
      }),
    ).rejects.toThrow();
  });

  it("rejects a DEPOT_MANAGER with no depotId", async () => {
    const { admin } = await seedOrgWithDepot();

    await expect(
      createUser(admin, {
        name: "Bad Depot Manager",
        email: `${unique("baddm")}@example.com`,
        role: "DEPOT_MANAGER",
        password: "a-real-password",
      }),
    ).rejects.toThrow(/depotId/);
  });

  it("accepts a DEPOT_MANAGER with a depotId", async () => {
    const { admin, depot } = await seedOrgWithDepot();

    const user = await createUser(admin, {
      name: "Depot Manager",
      email: `${unique("dm")}@example.com`,
      role: "DEPOT_MANAGER",
      depotId: depot.id,
      password: "a-real-password",
    });
    track(user.id);
    expect(user.depotId).toBe(depot.id);
  });
});

describe("updateUser / deactivateUser", () => {
  it("deactivates a user, records a STATUS_CHANGE audit entry, and reactivation works", async () => {
    const { admin } = await seedOrgWithDepot();
    const user = await createUser(admin, {
      name: "Toggle Me",
      email: `${unique("toggle")}@example.com`,
      role: "SURVEYOR",
      password: "a-real-password",
    });
    track(user.id);

    const deactivated = await deactivateUser(admin, user.id);
    expect(deactivated.status).toBe("INACTIVE");

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "User",
        entityId: user.id,
        action: "STATUS_CHANGE",
      },
    });
    expect(audit).not.toBeNull();

    const reactivated = await updateUser(admin, user.id, {
      status: "ACTIVE",
    });
    expect(reactivated.status).toBe("ACTIVE");
  });

  it("blocks an admin from deactivating their own account", async () => {
    const { admin } = await seedOrgWithDepot();

    await expect(deactivateUser(admin, admin.user.id)).rejects.toThrow(
      /cannot deactivate your own account/i,
    );
  });

  it("reassigns a user's role", async () => {
    const { admin } = await seedOrgWithDepot();
    const user = await createUser(admin, {
      name: "Reassign Me",
      email: `${unique("reassign")}@example.com`,
      role: "AUDITOR",
      password: "a-real-password",
    });
    track(user.id);

    const updated = await updateUser(admin, user.id, {
      role: "CLAIMS_MANAGER",
    });
    expect(updated.role).toBe("CLAIMS_MANAGER");
  });

  it("rejects reassigning to DEPOT_MANAGER without also setting a depotId", async () => {
    const { admin } = await seedOrgWithDepot();
    const user = await createUser(admin, {
      name: "Will Fail",
      email: `${unique("willfail")}@example.com`,
      role: "AUDITOR",
      password: "a-real-password",
    });
    track(user.id);

    await expect(
      updateUser(admin, user.id, { role: "DEPOT_MANAGER" }),
    ).rejects.toThrow(/depotId/);
  });
});

describe("listUsers / getUser", () => {
  it("never includes passwordHash", async () => {
    const { admin } = await seedOrgWithDepot();
    const user = await createUser(admin, {
      name: "List Me",
      email: `${unique("listme")}@example.com`,
      role: "SURVEYOR",
      password: "a-real-password",
    });
    track(user.id);

    const list = await listUsers(admin);
    expect(list.some((u) => u.id === user.id)).toBe(true);
    for (const u of list) expect(u).not.toHaveProperty("passwordHash");

    const fetched = await getUser(admin, user.id);
    expect(fetched).not.toHaveProperty("passwordHash");
  });
});
