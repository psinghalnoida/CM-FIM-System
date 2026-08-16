// Integration test for M30's StubAssistantProvider — real Postgres (its
// tool calls go through the real ASSISTANT_TOOLS, same as the real
// Claude provider would), no external API. Confirms the deterministic
// routing: "my work" phrasing hits get_my_work, a number/registration
// hits search_records (+ the matching detail tool), everything else
// falls back to the generic help message — and that every path records
// its tool calls.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { StubAssistantProvider } from "@/lib/assistant/stub-provider";
import { ASSISTANT_TOOLS } from "@/lib/assistant/tools";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  incidentIds: [] as string[],
  vehicleIds: [] as string[],
  userIds: [] as string[],
  depotIds: [] as string[],
  cityIds: [] as string[],
  orgIds: [] as string[],
};

afterEach(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.idCounter.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
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

async function seedOrg() {
  const org = await db.organization.create({ data: { code: unique("M30S"), name: "M30 Stub Test Org" } });
  cleanup.orgIds.push(org.id);
  const city = await db.city.create({ data: { organizationId: org.id, name: "City" } });
  cleanup.cityIds.push(city.id);
  const depot = await db.depot.create({
    data: { organizationId: org.id, cityId: city.id, code: unique("D"), name: "Depot" },
  });
  cleanup.depotIds.push(depot.id);
  const vehicle = await db.vehicle.create({
    data: { organizationId: org.id, depotId: depot.id, registrationNumber: unique("VEH") },
  });
  cleanup.vehicleIds.push(vehicle.id);
  return { org, depot, vehicle };
}

async function userSessionWithRole(org: { id: string }, role: "ORG_ADMIN"): Promise<AuthSession> {
  const user = await db.user.create({
    data: { organizationId: org.id, name: role, email: `${unique(role)}@example.com`, role },
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

describe("StubAssistantProvider (M30)", () => {
  it('routes "what\'s on my work queue" to get_my_work', async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const provider = new StubAssistantProvider();
    const { reply, toolCalls } = await provider.chat(
      admin,
      [{ role: "user", content: "What's on my work queue?" }],
      ASSISTANT_TOOLS,
    );
    expect(toolCalls.map((c) => c.name)).toEqual(["get_my_work"]);
    expect(reply).toMatch(/nothing outstanding|item/);
  });

  it("routes an incident number to search_records then get_incident", async () => {
    const { org, vehicle } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const incident = await createIncident(admin, {
      vehicleId: vehicle.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M30 stub provider test.",
    });
    cleanup.incidentIds.push(incident.id);

    const provider = new StubAssistantProvider();
    const { reply, toolCalls } = await provider.chat(
      admin,
      [{ role: "user", content: `What's the status of ${incident.incidentNumber}?` }],
      ASSISTANT_TOOLS,
    );
    expect(toolCalls.map((c) => c.name)).toEqual(["search_records", "get_incident"]);
    expect(reply).toContain(incident.incidentNumber);
  });

  it("falls back to the generic help message for unrecognized text — no tool calls", async () => {
    const { org } = await seedOrg();
    const admin = await userSessionWithRole(org, "ORG_ADMIN");
    const provider = new StubAssistantProvider();
    const { reply, toolCalls } = await provider.chat(
      admin,
      [{ role: "user", content: "hello there" }],
      ASSISTANT_TOOLS,
    );
    expect(toolCalls).toEqual([]);
    expect(reply).toMatch(/stub Mitra assistant/);
  });
});
