// Integration tests for M26's My Work (lib/my-work/my-work.ts) against a
// real Postgres instance: each role sees exactly the category(ies) its
// own module's WRITE_ROLES let it act on, DEPOT_MANAGER is depot-scoped,
// AUDITOR gets an explicit empty result, and ORG_ADMIN sees the union.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim } from "@/lib/claims/claim";
import { createSurvey } from "@/lib/claims/survey";
import { createRepairJob } from "@/lib/claims/repair-job";
import { createSettlement, acceptSettlement } from "@/lib/settlements/settlement";
import { createPayment } from "@/lib/settlements/payment";
import { createStageTemplate } from "@/lib/tat/stage-template";
import { getMyWork } from "@/lib/my-work/my-work";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  templateIds: [] as string[],
  settlementIds: [] as string[],
  repairJobIds: [] as string[],
  workshopIds: [] as string[],
  surveyIds: [] as string[],
  surveyorIds: [] as string[],
  claimIds: [] as string[],
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
  await db.tatHoldPeriod.deleteMany({
    where: { caseStageInstance: { organizationId: { in: cleanup.orgIds } } },
  });
  await db.caseStageInstance.deleteMany({ where: { organizationId: { in: cleanup.orgIds } } });
  await db.tatStageTemplate.deleteMany({ where: { id: { in: cleanup.templateIds } } });
  await db.payment.deleteMany({ where: { settlementId: { in: cleanup.settlementIds } } });
  await db.settlement.deleteMany({ where: { id: { in: cleanup.settlementIds } } });
  await db.repairJob.deleteMany({ where: { id: { in: cleanup.repairJobIds } } });
  await db.workshop.deleteMany({ where: { id: { in: cleanup.workshopIds } } });
  await db.survey.deleteMany({ where: { id: { in: cleanup.surveyIds } } });
  await db.surveyor.deleteMany({ where: { id: { in: cleanup.surveyorIds } } });
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.templateIds = [];
  cleanup.settlementIds = [];
  cleanup.repairJobIds = [];
  cleanup.workshopIds = [];
  cleanup.surveyIds = [];
  cleanup.surveyorIds = [];
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
  depotId: string | null,
  role:
    | "ORG_ADMIN"
    | "DEPOT_MANAGER"
    | "CLAIMS_MANAGER"
    | "SURVEYOR"
    | "WORKSHOP_COORDINATOR"
    | "FINANCE_OFFICER"
    | "AUDITOR",
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
    user: {
      id: user.id,
      organizationId: org.id,
      role,
      depotId,
      name: role,
      email: user.email,
      status: "ACTIVE",
    },
  } as AuthSession;
}

describe("getMyWork (M26)", () => {
  it("scopes items to what each role's own module already lets it act on", async () => {
    const org = await db.organization.create({
      data: { code: unique("M26"), name: "M26 Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const city = await db.city.create({ data: { organizationId: org.id, name: "City" } });
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
    const admin = await userSessionWithRole(org, null, "ORG_ADMIN");

    const incidentTemplate = await createStageTemplate(admin, {
      caseType: "INCIDENT",
      stageKey: unique("STAGE").toUpperCase(),
      stageName: "Assessment",
      sequenceOrder: 0,
      targetHours: 24,
    });
    cleanup.templateIds.push(incidentTemplate.id);
    const claimTemplate = await createStageTemplate(admin, {
      caseType: "INSURANCE_CLAIM",
      stageKey: unique("STAGE").toUpperCase(),
      stageName: "Survey scheduling",
      sequenceOrder: 0,
      targetHours: 100,
    });
    cleanup.templateIds.push(claimTemplate.id);

    // An open incident at depot A (no claim yet) — its own INCIDENT-typed
    // TAT stage auto-instantiates.
    const incident1 = await createIncident(admin, {
      vehicleId: vehicleA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M26 test incident 1.",
    });
    cleanup.incidentIds.push(incident1.id);

    // A second incident (at depot B) that's converted to a claim — its
    // claim gets its own INSURANCE_CLAIM-typed TAT stage, and its own
    // survey/repair-job/settlement/payment.
    const incident2 = await createIncident(admin, {
      vehicleId: vehicleB.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "M26 test incident 2.",
    });
    cleanup.incidentIds.push(incident2.id);
    const claim1 = await createClaim(admin, {
      incidentId: incident2.id,
      claimType: "INSURANCE",
    });
    cleanup.claimIds.push(claim1.id);
    const surveyor = await db.surveyor.create({
      data: { organizationId: org.id, name: unique("Surveyor") },
    });
    cleanup.surveyorIds.push(surveyor.id);
    const survey1 = await createSurvey(admin, {
      claimId: claim1.id,
      surveyorId: surveyor.id,
    });
    cleanup.surveyIds.push(survey1.id);
    const workshop = await db.workshop.create({
      data: { organizationId: org.id, name: unique("Workshop") },
    });
    cleanup.workshopIds.push(workshop.id);
    const repairJob1 = await createRepairJob(admin, {
      claimId: claim1.id,
      workshopId: workshop.id,
    });
    cleanup.repairJobIds.push(repairJob1.id);
    // Stays PENDING — the "open settlement" item.
    const settlement1 = await createSettlement(admin, {
      claimId: claim1.id,
      settlementAmount: 5000,
    });
    cleanup.settlementIds.push(settlement1.id);

    // A second settlement, accepted, so a payment can be recorded against
    // it — createPayment requires ACCEPTED (BR-09's own gate). Once
    // ACCEPTED it's no longer an "open settlement" itself; only its
    // unreconciled payment shows up.
    const settlement2 = await createSettlement(admin, {
      claimId: claim1.id,
      settlementAmount: 3000,
    });
    cleanup.settlementIds.push(settlement2.id);
    await acceptSettlement(admin, settlement2.id);
    const payment1 = await createPayment(admin, {
      settlementId: settlement2.id,
      amount: 3000,
      paymentDate: new Date(),
    });
    void payment1;

    // --- DEPOT_MANAGER at depot A: only incident1 + its incident-typed
    // TAT stage — nothing claim/survey/repair/settlement/payment-related. ---
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const managerWork = await getMyWork(managerA);
    expect(managerWork.items.map((i) => i.kind).sort()).toEqual([
      "INCIDENT",
      "TAT_STAGE",
    ]);
    expect(managerWork.items.find((i) => i.kind === "INCIDENT")?.id).toBe(
      incident1.id,
    );

    // --- CLAIMS_MANAGER: only claim1 + its claim-typed TAT stage. ---
    const claimsManager = await userSessionWithRole(org, null, "CLAIMS_MANAGER");
    const claimsWork = await getMyWork(claimsManager);
    expect(claimsWork.items.map((i) => i.kind).sort()).toEqual([
      "CLAIM",
      "TAT_STAGE",
    ]);
    expect(claimsWork.items.find((i) => i.kind === "CLAIM")?.id).toBe(claim1.id);

    // --- SURVEYOR: only survey1. ---
    const surveyorSession = await userSessionWithRole(org, null, "SURVEYOR");
    const surveyorWork = await getMyWork(surveyorSession);
    expect(surveyorWork.items).toHaveLength(1);
    expect(surveyorWork.items[0].kind).toBe("SURVEY");
    expect(surveyorWork.items[0].id).toBe(survey1.id);

    // --- WORKSHOP_COORDINATOR: only repairJob1. ---
    const workshopSession = await userSessionWithRole(
      org,
      null,
      "WORKSHOP_COORDINATOR",
    );
    const workshopWork = await getMyWork(workshopSession);
    expect(workshopWork.items).toHaveLength(1);
    expect(workshopWork.items[0].kind).toBe("REPAIR_JOB");
    expect(workshopWork.items[0].id).toBe(repairJob1.id);

    // --- FINANCE_OFFICER: settlement1 + payment1 (unreconciled). ---
    const finance = await userSessionWithRole(org, null, "FINANCE_OFFICER");
    const financeWork = await getMyWork(finance);
    expect(financeWork.items.map((i) => i.kind).sort()).toEqual([
      "PAYMENT",
      "SETTLEMENT",
    ]);

    // --- AUDITOR: explicit empty result. ---
    const auditor = await userSessionWithRole(org, null, "AUDITOR");
    const auditorWork = await getMyWork(auditor);
    expect(auditorWork.items).toEqual([]);

    // --- ORG_ADMIN: the union of everything above (3 active TAT
    // stages + 2 open incidents + 1 claim + 1 survey + 1 repair job +
    // 1 settlement + 1 unreconciled payment). ---
    const adminWork = await getMyWork(admin);
    const kindCounts = adminWork.items.reduce<Record<string, number>>(
      (acc, item) => {
        acc[item.kind] = (acc[item.kind] ?? 0) + 1;
        return acc;
      },
      {},
    );
    // incident1 (never converted) and incident2 (converted to claim1
    // but never explicitly closed — an incident stays OPEN after
    // conversion until closeIncident() is called, per docs/INCIDENTS.md).
    expect(kindCounts.INCIDENT).toBe(2);
    expect(kindCounts.CLAIM).toBe(1);
    expect(kindCounts.SURVEY).toBe(1);
    expect(kindCounts.REPAIR_JOB).toBe(1);
    expect(kindCounts.SETTLEMENT).toBe(1);
    expect(kindCounts.PAYMENT).toBe(1);
    // incident1's and incident2's own INCIDENT-typed stages, plus
    // claim1's INSURANCE_CLAIM-typed stage.
    expect(kindCounts.TAT_STAGE).toBe(3);
  });
});
