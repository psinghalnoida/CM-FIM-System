// Integration tests for the M3 auth flow against a real Postgres instance:
// credential verification, DB session lifecycle, and performLogin() (the
// part of the login Server Action that doesn't need cookies()/Next request
// context — see lib/auth-actions.ts).
//
// Requires DATABASE_URL and SESSION_SECRET.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  createDbSession,
  getActiveDbSession,
  revokeDbSession,
  verifyCredentials,
} from "@/lib/session-service";
import { performLogin } from "@/lib/auth-actions";
import { decryptSessionCookie } from "@/lib/session-crypto";

beforeAll(() => {
  process.env.SESSION_SECRET ??= "test-secret-do-not-use-in-real-environments";
});

const cleanup: {
  userIds: string[];
  depotIds: string[];
  cityIds: string[];
  orgIds: string[];
} = {
  userIds: [],
  depotIds: [],
  cityIds: [],
  orgIds: [],
};

afterEach(async () => {
  await db.auditLog.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.session.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.userIds = [];
  cleanup.depotIds = [];
  cleanup.cityIds = [];
  cleanup.orgIds = [];
});

async function seedTestUser(
  overrides: { status?: "ACTIVE" | "INACTIVE" | "SUSPENDED" } = {},
) {
  const org = await db.organization.create({
    data: {
      code: `AUTH-${Date.now()}-${Math.random()}`,
      name: "Auth Test Org",
    },
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
      code: "D1",
      name: "Depot",
    },
  });
  cleanup.depotIds.push(depot.id);

  const passwordHash = await hashPassword("correct-password");
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      depotId: depot.id,
      name: "Test User",
      email: `user-${Date.now()}-${Math.random()}@example.com`,
      passwordHash,
      role: "CLAIMS_MANAGER",
      status: overrides.status ?? "ACTIVE",
    },
  });
  cleanup.userIds.push(user.id);
  return { org, user };
}

describe("verifyCredentials", () => {
  it("returns the user for correct email + password", async () => {
    const { user } = await seedTestUser();
    const result = await verifyCredentials(user.email, "correct-password");
    expect(result?.id).toBe(user.id);
  });

  it("returns null for a wrong password", async () => {
    const { user } = await seedTestUser();
    const result = await verifyCredentials(user.email, "wrong-password");
    expect(result).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    const result = await verifyCredentials("nobody@example.com", "anything");
    expect(result).toBeNull();
  });

  it("returns null for an inactive user, even with the right password", async () => {
    const { user } = await seedTestUser({ status: "INACTIVE" });
    const result = await verifyCredentials(user.email, "correct-password");
    expect(result).toBeNull();
  });
});

describe("DB session lifecycle", () => {
  it("creates and retrieves an active session", async () => {
    const { user } = await seedTestUser();
    const session = await createDbSession(user.id);
    const active = await getActiveDbSession(session.id);
    expect(active?.id).toBe(session.id);
    expect(active?.user.id).toBe(user.id);
  });

  it("treats a revoked session as inactive", async () => {
    const { user } = await seedTestUser();
    const session = await createDbSession(user.id);
    await revokeDbSession(session.id);
    const active = await getActiveDbSession(session.id);
    expect(active).toBeNull();
  });

  it("treats an expired session as inactive", async () => {
    const { user } = await seedTestUser();
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });
    const active = await getActiveDbSession(session.id);
    expect(active).toBeNull();
  });

  it("returns null for an unknown session id", async () => {
    const active = await getActiveDbSession(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(active).toBeNull();
  });
});

describe("performLogin", () => {
  it("returns a cookie value that decrypts to a valid, active session", async () => {
    const { user } = await seedTestUser();
    const result = await performLogin(user.email, "correct-password");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const payload = await decryptSessionCookie(result.cookieValue);
    expect(payload).not.toBeNull();
    const active = await getActiveDbSession(payload!.sessionId);
    expect(active?.user.id).toBe(user.id);
  });

  it("records a LOGIN audit entry on success", async () => {
    const { user } = await seedTestUser();
    await performLogin(user.email, "correct-password");

    const entry = await db.auditLog.findFirst({
      where: { entityType: "User", entityId: user.id, action: "LOGIN" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.sourceChannel).toBe("WEB");
  });

  it("fails without creating a session for a wrong password", async () => {
    const { user } = await seedTestUser();
    const result = await performLogin(user.email, "wrong-password");
    expect(result.ok).toBe(false);

    const sessions = await db.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(0);
  });
});
