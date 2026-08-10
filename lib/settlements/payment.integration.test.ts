// Integration tests for the M14 payment service (lib/settlements/payment.ts)
// against a real Postgres instance: createPayment's RBAC + "settlement must
// be ACCEPTED" gate, reconcilePayment's success/already-reconciled/cross-org
// paths (Payment has no organizationId column — see the comment in
// lib/settlements/payment.ts), and listPaymentsForSettlement.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createClaim, transitionClaimStatus } from "@/lib/claims/claim";
import {
  acceptSettlement,
  createSettlement,
} from "@/lib/settlements/settlement";
import {
  createPayment,
  listPaymentsForSettlement,
  reconcilePayment,
} from "@/lib/settlements/payment";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  settlementIds: [] as string[],
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
  await db.payment.deleteMany({
    where: { settlementId: { in: cleanup.settlementIds } },
  });
  await db.settlement.deleteMany({
    where: { id: { in: cleanup.settlementIds } },
  });
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.settlementIds = [];
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
  role: "ORG_ADMIN" | "FINANCE_OFFICER" | "CLAIMS_MANAGER",
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

/** Seeds an org with a claim walked to SETTLED and a PENDING settlement on it. */
async function seedOrgWithPendingSettlement(amount = 5000) {
  const org = await db.organization.create({
    data: { code: unique("M14P"), name: "M14 Payment Test Org" },
  });
  cleanup.orgIds.push(org.id);
  const admin = await userSessionWithRole(org, "ORG_ADMIN");
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
  const vehicle = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depot.id,
      registrationNumber: unique("V"),
    },
  });
  cleanup.vehicleIds.push(vehicle.id);
  const incident = await db.incident.create({
    data: {
      organizationId: org.id,
      incidentNumber: unique("INC"),
      vehicleId: vehicle.id,
      depotId: depot.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M14 payment test incident.",
    },
  });
  cleanup.incidentIds.push(incident.id);

  const claim = await createClaim(admin, {
    incidentId: incident.id,
    claimType: "INSURANCE",
  });
  cleanup.claimIds.push(claim.id);
  await transitionClaimStatus(admin, claim.id, "UNDER_SURVEY");
  await transitionClaimStatus(admin, claim.id, "UNDER_REPAIR");
  await transitionClaimStatus(admin, claim.id, "PENDING_SETTLEMENT");
  await transitionClaimStatus(admin, claim.id, "SETTLED");

  const settlement = await createSettlement(admin, {
    claimId: claim.id,
    settlementAmount: amount,
  });
  cleanup.settlementIds.push(settlement.id);

  return { org, admin, claim, settlement };
}

describe("createPayment", () => {
  it("rejects recording a payment against a PENDING (not yet ACCEPTED) settlement", async () => {
    const { admin, settlement } = await seedOrgWithPendingSettlement();

    await expect(
      createPayment(admin, {
        settlementId: settlement.id,
        amount: 1000,
        paymentDate: new Date(),
      }),
    ).rejects.toThrow(/not ACCEPTED/);
  });

  it("FINANCE_OFFICER and ORG_ADMIN can record a payment once ACCEPTED; CLAIMS_MANAGER cannot", async () => {
    const { org, admin, settlement } = await seedOrgWithPendingSettlement();
    await acceptSettlement(admin, settlement.id);
    const financeOfficer = await userSessionWithRole(org, "FINANCE_OFFICER");
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    const payment = await createPayment(financeOfficer, {
      settlementId: settlement.id,
      amount: 2500,
      paymentDate: new Date("2026-01-15"),
      paymentReference: "REF-1",
    });
    expect(payment.settlementId).toBe(settlement.id);
    expect(payment.reconciled).toBe(false);
    expect(payment.currency).toBe(settlement.currency);

    await expect(
      createPayment(claimsManager, {
        settlementId: settlement.id,
        amount: 2500,
        paymentDate: new Date(),
      }),
    ).rejects.toThrow();

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Payment", entityId: payment.id, action: "CREATE" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("reconcilePayment", () => {
  it("marks a payment reconciled, records audit, and rejects reconciling it twice", async () => {
    const { admin, settlement } = await seedOrgWithPendingSettlement();
    await acceptSettlement(admin, settlement.id);
    const payment = await createPayment(admin, {
      settlementId: settlement.id,
      amount: 5000,
      paymentDate: new Date(),
    });

    const reconciled = await reconcilePayment(admin, payment.id);
    expect(reconciled.reconciled).toBe(true);
    expect(reconciled.reconciledById).toBe(admin.user.id);
    expect(reconciled.reconciledAt).not.toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Payment", entityId: payment.id, action: "UPDATE" },
    });
    expect(audit).not.toBeNull();

    await expect(reconcilePayment(admin, payment.id)).rejects.toThrow(
      /already reconciled/,
    );
  });

  it("returns 404 (not the cross-org payment) when reconciling another org's payment by id", async () => {
    const { admin: adminA, settlement: settlementA } =
      await seedOrgWithPendingSettlement();
    await acceptSettlement(adminA, settlementA.id);
    const paymentA = await createPayment(adminA, {
      settlementId: settlementA.id,
      amount: 5000,
      paymentDate: new Date(),
    });

    const { admin: adminB } = await seedOrgWithPendingSettlement();

    await expect(reconcilePayment(adminB, paymentA.id)).rejects.toThrow(
      /not found/i,
    );

    // Confirm it genuinely wasn't touched by the rejected cross-org attempt.
    const stillUnreconciled = await db.payment.findUniqueOrThrow({
      where: { id: paymentA.id },
    });
    expect(stillUnreconciled.reconciled).toBe(false);
  });
});

describe("listPaymentsForSettlement", () => {
  it("lists payments for a settlement ordered by payment date", async () => {
    const { admin, settlement } = await seedOrgWithPendingSettlement();
    await acceptSettlement(admin, settlement.id);
    await createPayment(admin, {
      settlementId: settlement.id,
      amount: 2000,
      paymentDate: new Date("2026-02-01"),
    });
    await createPayment(admin, {
      settlementId: settlement.id,
      amount: 3000,
      paymentDate: new Date("2026-01-01"),
    });

    const list = await listPaymentsForSettlement(admin, settlement.id);
    expect(list).toHaveLength(2);
    expect(list[0].amount.toString()).toBe("3000");
    expect(list[1].amount.toString()).toBe("2000");
  });
});
