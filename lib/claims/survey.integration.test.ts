// Integration tests for the M7 survey service (lib/claims/survey.ts)
// against a real Postgres instance: RBAC, depot-scoping through the
// parent claim/incident, human-readable ID generation, and the
// SurveyStatus transition map.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createClaim } from "@/lib/claims/claim";
import {
  createSurvey,
  listSurveysForClaim,
  transitionSurveyStatus,
  updateSurvey,
} from "@/lib/claims/survey";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const cleanup = {
  surveyIds: [] as string[],
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
  await db.survey.deleteMany({ where: { id: { in: cleanup.surveyIds } } });
  await db.claim.deleteMany({ where: { id: { in: cleanup.claimIds } } });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.surveyIds = [];
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

async function seedOrgWithClaim() {
  const org = await db.organization.create({
    data: { code: unique("M7S"), name: "M7 Survey Test Org" },
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
  const vehicle = await db.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depotA.id,
      registrationNumber: unique("V"),
    },
  });
  cleanup.vehicleIds.push(vehicle.id);
  const incident = await db.incident.create({
    data: {
      organizationId: org.id,
      incidentNumber: unique("INC"),
      vehicleId: vehicle.id,
      depotId: depotA.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Test incident.",
    },
  });
  cleanup.incidentIds.push(incident.id);
  const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
  const claim = await createClaim(admin, {
    incidentId: incident.id,
    claimType: "MAINTENANCE",
  });
  cleanup.claimIds.push(claim.id);
  return { org, depotA, depotB, claim, admin };
}

async function userSessionWithRole(
  org: { id: string },
  depotId: string | null,
  role: "ORG_ADMIN" | "DEPOT_MANAGER" | "CLAIMS_MANAGER" | "SURVEYOR",
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
    user,
  } as AuthSession;
}

function track(surveyId: string) {
  cleanup.surveyIds.push(surveyId);
  return surveyId;
}

describe("createSurvey", () => {
  it("generates SUR-YYYY-###### and records a CREATE audit entry", async () => {
    const { claim, admin } = await seedOrgWithClaim();

    const survey = await createSurvey(admin, {
      claimId: claim.id,
      surveyorName: "Jane Surveyor",
    });
    track(survey.id);

    const year = new Date().getFullYear();
    expect(survey.surveyNumber).toMatch(new RegExp(`^SUR-${year}-\\d{6}$`));

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Survey", entityId: survey.id, action: "CREATE" },
    });
    expect(audit).not.toBeNull();
  });

  it("SURVEYOR can create surveys; DEPOT_MANAGER cannot", async () => {
    const { org, depotA, claim } = await seedOrgWithClaim();
    const surveyor = await userSessionWithRole(org, null, "SURVEYOR");
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");

    const survey = await createSurvey(surveyor, {
      claimId: claim.id,
      surveyorName: "Agency Rep",
    });
    track(survey.id);
    expect(survey.id).toBeDefined();

    await expect(
      createSurvey(managerA, {
        claimId: claim.id,
        surveyorName: "Should fail",
      }),
    ).rejects.toThrow();
  });

  it("rejects a DEPOT_MANAGER from a different depot", async () => {
    const { org, depotB, claim } = await seedOrgWithClaim();
    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");

    await expect(
      createSurvey(managerB, {
        claimId: claim.id,
        surveyorName: "Wrong depot",
      }),
    ).rejects.toThrow();
  });
});

describe("updateSurvey", () => {
  it("updates findings and records an UPDATE audit entry", async () => {
    const { claim, admin } = await seedOrgWithClaim();
    const survey = await createSurvey(admin, {
      claimId: claim.id,
      surveyorName: "Jane Surveyor",
    });
    track(survey.id);

    const updated = await updateSurvey(admin, survey.id, {
      findings: "Front bumper damage, minor.",
    });
    expect(updated.findings).toBe("Front bumper damage, minor.");

    const audit = await db.auditLog.findFirst({
      where: { entityType: "Survey", entityId: survey.id, action: "UPDATE" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("transitionSurveyStatus", () => {
  it("walks SCHEDULED -> IN_PROGRESS -> COMPLETED", async () => {
    const { claim, admin } = await seedOrgWithClaim();
    const survey = await createSurvey(admin, {
      claimId: claim.id,
      surveyorName: "Jane Surveyor",
    });
    track(survey.id);
    expect(survey.status).toBe("SCHEDULED");

    const inProgress = await transitionSurveyStatus(
      admin,
      survey.id,
      "IN_PROGRESS",
    );
    expect(inProgress.status).toBe("IN_PROGRESS");
    const completed = await transitionSurveyStatus(
      admin,
      survey.id,
      "COMPLETED",
    );
    expect(completed.status).toBe("COMPLETED");
  });

  it("rejects a transition out of a terminal status (409)", async () => {
    const { claim, admin } = await seedOrgWithClaim();
    const survey = await createSurvey(admin, {
      claimId: claim.id,
      surveyorName: "Jane Surveyor",
    });
    track(survey.id);

    await transitionSurveyStatus(admin, survey.id, "CANCELLED");
    await expect(
      transitionSurveyStatus(admin, survey.id, "IN_PROGRESS"),
    ).rejects.toThrow(/Cannot transition/);
  });
});

describe("listSurveysForClaim", () => {
  it("is depot-scoped for DEPOT_MANAGER via the claim's incident", async () => {
    const { org, depotA, depotB, claim, admin } = await seedOrgWithClaim();
    const managerA = await userSessionWithRole(org, depotA.id, "DEPOT_MANAGER");
    const managerB = await userSessionWithRole(org, depotB.id, "DEPOT_MANAGER");

    const survey = await createSurvey(admin, {
      claimId: claim.id,
      surveyorName: "Jane Surveyor",
    });
    track(survey.id);

    const asManagerA = await listSurveysForClaim(managerA, claim.id);
    expect(asManagerA.map((s) => s.id)).toEqual([survey.id]);

    await expect(listSurveysForClaim(managerB, claim.id)).rejects.toThrow();
  });
});
