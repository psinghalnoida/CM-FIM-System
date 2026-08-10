// M15 e2e smoke test — the one true end-to-end check in this repo: real
// HTTP against a running, built instance of the app (not vitest calling
// service functions directly, which is what every *.integration.test.ts
// file already does thoroughly). Formalizes the same walkthrough done by
// hand after every milestone (see docs/PAYMENTS.md, docs/ESCALATIONS.md,
// docs/OCR.md, ...) into a repeatable script rather than adding a new
// browser-automation framework for a single golden-path check — the app
// has no client-side interactivity this couldn't already cover via its
// API routes and server-rendered pages.
//
// Requires the app already built and running (`npm run build && npm run
// start`, or `npm run dev`), plus DATABASE_URL/SESSION_SECRET pointed at
// the same database the running app uses. Mints its own org/user/session
// directly against the database (the same approach used for every
// milestone's manual HTTP walkthrough — there is no plain HTTP login
// endpoint to drive; login is a Server Action, not a JSON API route) and
// cleans up everything it creates on exit, success or failure.
//
// Run via: npm run test:e2e (BASE_URL defaults to http://localhost:3000)
import { db } from "@/lib/db";
import { createDbSession } from "@/lib/session-service";
import { encryptSessionCookie } from "@/lib/session-crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${message}`);
  }
}

async function api(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response (e.g. an HTML error page) — leave json null,
    // callers that need it will fail their own assertion legibly.
  }
  return { status: res.status, json };
}

const cleanup = {
  orgIds: [] as string[],
};

async function seedActor(
  orgSuffix: string,
  role: "ORG_ADMIN" | "CLAIMS_MANAGER",
) {
  const org = await db.organization.upsert({
    where: { code: `E2E-${orgSuffix}` },
    create: { code: `E2E-${orgSuffix}`, name: `E2E Test Org ${orgSuffix}` },
    update: {},
  });
  cleanup.orgIds.push(org.id);
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      name: `E2E ${role}`,
      email: `e2e-${orgSuffix}-${Date.now()}@example.com`,
      role,
    },
  });
  const session = await createDbSession(user.id);
  const cookie = `cm_fim_session=${await encryptSessionCookie({ sessionId: session.id })}`;
  return { org, user, cookie };
}

async function main() {
  console.log(`e2e: BASE_URL=${BASE_URL}`);
  const health = await fetch(`${BASE_URL}/login`).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `Cannot reach ${BASE_URL}/login — is the app running? (npm run build && npm run start)`,
    );
    process.exit(1);
  }

  const { org, cookie } = await seedActor("A", "ORG_ADMIN");
  const city = await db.city.create({
    data: { organizationId: org.id, name: "E2E City" },
  });
  const depot = await db.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: "E2E-D1",
      name: "E2E Depot",
    },
  });
  const vehicle = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depot.id,
      registrationNumber: `E2E-V-${Date.now()}`,
    },
  });
  const incident = await db.incident.create({
    data: {
      organizationId: org.id,
      incidentNumber: `E2E-INC-${Date.now()}`,
      vehicleId: vehicle.id,
      depotId: depot.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "e2e smoke test incident.",
    },
  });

  console.log("\n1) claim lifecycle: OPEN -> ... -> SETTLED");
  const claimRes = await api("POST", "/api/claims", cookie, {
    incidentId: incident.id,
    claimType: "INSURANCE",
  });
  assert(claimRes.status === 201, `create claim (got ${claimRes.status})`);
  const claim = claimRes.json as { id: string; status: string };

  for (const status of [
    "UNDER_SURVEY",
    "UNDER_REPAIR",
    "PENDING_SETTLEMENT",
    "SETTLED",
  ]) {
    const res = await api("POST", `/api/claims/${claim.id}/status`, cookie, {
      status,
    });
    assert(
      res.status === 200,
      `transition claim -> ${status} (got ${res.status})`,
    );
  }

  console.log("\n2) BR-09 closure gate, checked at every blocking stage");
  const settlementRes = await api(
    "POST",
    `/api/claims/${claim.id}/settlements`,
    cookie,
    { settlementAmount: 10000 },
  );
  assert(
    settlementRes.status === 201,
    `create settlement (got ${settlementRes.status})`,
  );
  const settlement = settlementRes.json as { id: string };

  const blockedPending = await api(
    "POST",
    `/api/claims/${claim.id}/status`,
    cookie,
    {
      status: "CLOSED",
    },
  );
  assert(
    blockedPending.status === 409,
    `close blocked while settlement PENDING (got ${blockedPending.status})`,
  );

  const approveRes = await api(
    "POST",
    `/api/claims/${claim.id}/settlements/${settlement.id}/approve`,
    cookie,
  );
  assert(
    approveRes.status === 200,
    `approve settlement (got ${approveRes.status})`,
  );

  const paymentRes = await api(
    "POST",
    `/api/claims/${claim.id}/settlements/${settlement.id}/payments`,
    cookie,
    { amount: 10000, paymentDate: new Date().toISOString() },
  );
  assert(
    paymentRes.status === 201,
    `record payment (got ${paymentRes.status})`,
  );
  const payment = paymentRes.json as { id: string };

  const blockedUnreconciled = await api(
    "POST",
    `/api/claims/${claim.id}/status`,
    cookie,
    {
      status: "CLOSED",
    },
  );
  assert(
    blockedUnreconciled.status === 409,
    `close blocked while payment unreconciled (got ${blockedUnreconciled.status})`,
  );

  const reconcileRes = await api(
    "POST",
    `/api/claims/${claim.id}/settlements/${settlement.id}/payments/${payment.id}/reconcile`,
    cookie,
  );
  assert(
    reconcileRes.status === 200,
    `reconcile payment (got ${reconcileRes.status})`,
  );

  const closeRes = await api("POST", `/api/claims/${claim.id}/status`, cookie, {
    status: "CLOSED",
  });
  assert(closeRes.status === 200, `close claim (got ${closeRes.status})`);
  assert(
    (closeRes.json as { status?: string } | null)?.status === "CLOSED",
    "closed claim reports status CLOSED",
  );

  console.log("\n3) claim detail page renders the closed claim");
  const pageRes = await fetch(`${BASE_URL}/claims/${claim.id}`, {
    headers: { Cookie: cookie },
  });
  const pageHtml = await pageRes.text();
  assert(
    pageRes.status === 200,
    `claim detail page loads (got ${pageRes.status})`,
  );
  assert(pageHtml.includes("CLOSED"), "claim detail page shows CLOSED status");
  assert(
    pageHtml.includes("10000"),
    "claim detail page shows the settlement amount",
  );

  console.log(
    "\n4) cross-org RBAC: a second org cannot see or act on this claim",
  );
  const { cookie: otherCookie } = await seedActor("B", "CLAIMS_MANAGER");
  const crossOrgRead = await fetch(`${BASE_URL}/claims/${claim.id}`, {
    headers: { Cookie: otherCookie },
  });
  assert(
    crossOrgRead.status === 404,
    `cross-org claim read is 404 (got ${crossOrgRead.status})`,
  );
  const crossOrgSettlement = await api(
    "POST",
    `/api/claims/${claim.id}/settlements`,
    otherCookie,
    { settlementAmount: 1 },
  );
  assert(
    crossOrgSettlement.status === 404 || crossOrgSettlement.status === 403,
    `cross-org settlement create is rejected (got ${crossOrgSettlement.status})`,
  );

  console.log("\n5) unauthenticated request is rejected");
  const unauth = await fetch(`${BASE_URL}/api/claims`);
  assert(
    unauth.status === 401,
    `unauthenticated request is 401 (got ${unauth.status})`,
  );

  console.log(
    failures === 0
      ? `\ne2e: all checks passed`
      : `\ne2e: ${failures} check(s) FAILED`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    failures += 1;
  })
  .finally(async () => {
    await db.auditLog.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.idCounter.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.payment.deleteMany({
      where: { settlement: { organizationId: { in: cleanup.orgIds } } },
    });
    await db.settlement.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.claim.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.incident.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.vehicle.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.session.deleteMany({
      where: { user: { organizationId: { in: cleanup.orgIds } } },
    });
    await db.user.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.depot.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.city.deleteMany({
      where: { organizationId: { in: cleanup.orgIds } },
    });
    await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
    await db.$disconnect();
    process.exitCode = failures === 0 ? 0 : 1;
  });
