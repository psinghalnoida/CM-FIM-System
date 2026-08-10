// Integration tests for the M14 settlement service
// (lib/settlements/settlement.ts) against a real Postgres instance: RBAC,
// approve/reject transitions, and BR-09's closure gate as wired into
// lib/claims/claim.ts's transitionClaimStatus().
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
  disputeSettlement,
  getSettlement,
  listSettlementsForClaim,
  requestSettlementReview,
} from "@/lib/settlements/settlement";
import { createPayment, reconcilePayment } from "@/lib/settlements/payment";

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

/** Seeds an org with a claim already walked to SETTLED (one step away from CLOSED, which is where BR-09's gate lives). */
async function seedOrgWithSettledClaim() {
  const org = await db.organization.create({
    data: { code: unique("M14"), name: "M14 Test Org" },
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
      description: "M14 test incident.",
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

  return { org, admin, claim };
}

function track(id: string) {
  cleanup.settlementIds.push(id);
  return id;
}

describe("createSettlement", () => {
  it("FINANCE_OFFICER and ORG_ADMIN can create; CLAIMS_MANAGER cannot", async () => {
    const { org, admin, claim } = await seedOrgWithSettledClaim();
    const financeOfficer = await userSessionWithRole(org, "FINANCE_OFFICER");
    const claimsManager = await userSessionWithRole(org, "CLAIMS_MANAGER");

    const settlement = await createSettlement(financeOfficer, {
      claimId: claim.id,
      settlementAmount: 10000,
    });
    track(settlement.id);
    expect(settlement.status).toBe("PENDING");
    expect(settlement.currency).toBe("INR");

    await expect(
      createSettlement(claimsManager, {
        claimId: claim.id,
        settlementAmount: 5000,
      }),
    ).rejects.toThrow();

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Settlement",
        entityId: settlement.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
    void admin;
  });
});

describe("acceptSettlement / disputeSettlement / requestSettlementReview", () => {
  it("transitions PENDING -> ACCEPTED, records audit, and rejects re-deciding it (409)", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);

    const accepted = await acceptSettlement(admin, settlement.id);
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.respondedById).toBe(admin.user.id);

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "Settlement",
        entityId: settlement.id,
        action: "STATUS_CHANGE",
      },
    });
    expect(audit).not.toBeNull();

    await expect(disputeSettlement(admin, settlement.id)).rejects.toThrow(
      /already been accepted/,
    );
  });

  it("transitions PENDING -> DISPUTED", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);

    const disputed = await disputeSettlement(admin, settlement.id);
    expect(disputed.status).toBe("DISPUTED");
  });

  it("transitions PENDING -> REVIEW_REQUESTED", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);

    const reviewRequested = await requestSettlementReview(
      admin,
      settlement.id,
    );
    expect(reviewRequested.status).toBe("REVIEW_REQUESTED");
  });

  it("a DISPUTED settlement isn't terminal — JBM can still accept it once the insurer responds", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);

    await disputeSettlement(admin, settlement.id);
    const accepted = await acceptSettlement(admin, settlement.id);
    expect(accepted.status).toBe("ACCEPTED");
  });
});

describe("listSettlementsForClaim / getSettlement", () => {
  it("lists settlements with their payments included", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);

    const list = await listSettlementsForClaim(admin, claim.id);
    expect(list).toHaveLength(1);
    expect(list[0].payments).toEqual([]);

    const fetched = await getSettlement(admin, settlement.id);
    expect(fetched?.id).toBe(settlement.id);
  });
});

describe("BR-09: closure gate", () => {
  it("blocks CLOSED while a settlement is still PENDING", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);

    await expect(
      transitionClaimStatus(admin, claim.id, "CLOSED"),
    ).rejects.toThrow(/still PENDING/);
  });

  it("blocks CLOSED while an ACCEPTED settlement's payments don't sum to its amount", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);
    await acceptSettlement(admin, settlement.id);
    await createPayment(admin, {
      settlementId: settlement.id,
      amount: 2000,
      paymentDate: new Date(),
    });

    await expect(
      transitionClaimStatus(admin, claim.id, "CLOSED"),
    ).rejects.toThrow(/don't yet sum/);
  });

  it("blocks CLOSED while a payment is unreconciled", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);
    await acceptSettlement(admin, settlement.id);
    await createPayment(admin, {
      settlementId: settlement.id,
      amount: 5000,
      paymentDate: new Date(),
    });

    await expect(
      transitionClaimStatus(admin, claim.id, "CLOSED"),
    ).rejects.toThrow(/unreconciled/);
  });

  it("allows CLOSED once the settlement is ACCEPTED, fully paid, and reconciled", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);
    await acceptSettlement(admin, settlement.id);
    const payment = await createPayment(admin, {
      settlementId: settlement.id,
      amount: 5000,
      paymentDate: new Date(),
    });
    await reconcilePayment(admin, payment.id);

    const closed = await transitionClaimStatus(admin, claim.id, "CLOSED");
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
  });

  it("a DISPUTED settlement blocks closure, even unpaid — unlike the pre-M19 REJECTED exclusion", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);
    await disputeSettlement(admin, settlement.id);

    await expect(
      transitionClaimStatus(admin, claim.id, "CLOSED"),
    ).rejects.toThrow(/still DISPUTED/);
  });

  it("splitting a settlement across two payments that together sum correctly still closes", async () => {
    const { admin, claim } = await seedOrgWithSettledClaim();
    const settlement = await createSettlement(admin, {
      claimId: claim.id,
      settlementAmount: 5000,
    });
    track(settlement.id);
    await acceptSettlement(admin, settlement.id);
    const p1 = await createPayment(admin, {
      settlementId: settlement.id,
      amount: 3000,
      paymentDate: new Date(),
    });
    const p2 = await createPayment(admin, {
      settlementId: settlement.id,
      amount: 2000,
      paymentDate: new Date(),
    });
    await reconcilePayment(admin, p1.id);
    await reconcilePayment(admin, p2.id);

    const closed = await transitionClaimStatus(admin, claim.id, "CLOSED");
    expect(closed.status).toBe("CLOSED");
  });
});
