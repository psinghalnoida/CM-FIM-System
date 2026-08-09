// Integration tests for the M13 escalation scan/fire engine
// (lib/escalations/scan.ts) against a real Postgres instance: breach
// detection (including the PR-02 ON_HOLD exclusion), threshold gating,
// idempotent firing, non-EMAIL channel skipping, depot-scoped
// DEPOT_MANAGER recipient resolution, and org scoping.
//
// The email provider is spied on rather than actually sent anywhere —
// ConsoleEmailProvider just logs, so this confirms it was called with
// the right recipients without needing a real inbox.
//
// Requires DATABASE_URL. forbidden()/unauthorized() need
// __NEXT_EXPERIMENTAL_AUTH_INTERRUPTS set by hand — see lib/dal.test.ts.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { AuthSession } from "@/lib/dal";
import { createIncident } from "@/lib/incidents/incident";
import { createStageTemplate } from "@/lib/tat/stage-template";
import { createEscalationRule } from "@/lib/escalations/escalation-rule";
import { scanAndFireEscalations } from "@/lib/escalations/scan";
import { ConsoleEmailProvider } from "@/lib/email/console-provider";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

const sendSpy = vi
  .spyOn(ConsoleEmailProvider.prototype, "send")
  .mockResolvedValue(undefined);

afterEach(() => {
  sendSpy.mockClear();
});

const cleanup = {
  ruleIds: [] as string[],
  templateIds: [] as string[],
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
  await db.escalationEvent.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.escalationRule.deleteMany({
    where: { id: { in: cleanup.ruleIds } },
  });
  await db.caseStageInstance.deleteMany({
    where: { organizationId: { in: cleanup.orgIds } },
  });
  await db.tatStageTemplate.deleteMany({
    where: { id: { in: cleanup.templateIds } },
  });
  await db.incident.deleteMany({ where: { id: { in: cleanup.incidentIds } } });
  await db.vehicle.deleteMany({ where: { id: { in: cleanup.vehicleIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await db.depot.deleteMany({ where: { id: { in: cleanup.depotIds } } });
  await db.city.deleteMany({ where: { id: { in: cleanup.cityIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  cleanup.ruleIds = [];
  cleanup.templateIds = [];
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
  role: "ORG_ADMIN" | "DEPOT_MANAGER",
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

/** Seeds an org with a 1-hour-target INCIDENT stage template, a breached (2h overdue) IN_PROGRESS stage, and returns the pieces to attach rules/assertions to. */
async function seedBreachedIncidentStage(org: { id: string }) {
  const admin = await userSessionWithRole(org, null, "ORG_ADMIN");
  const template = await createStageTemplate(admin, {
    caseType: "INCIDENT",
    stageKey: unique("STAGE").toUpperCase(),
    stageName: "Breach test stage",
    sequenceOrder: 0,
    targetHours: 1,
  });
  cleanup.templateIds.push(template.id);

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

  const incident = await createIncident(admin, {
    vehicleId: vehicle.id,
    incidentDateTime: new Date(),
    incidentType: "ACCIDENT",
    description: "M13 scan test incident.",
  });
  cleanup.incidentIds.push(incident.id);

  const stage = await db.caseStageInstance.findFirstOrThrow({
    where: { incidentId: incident.id },
  });
  const pastDueAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours overdue
  await db.caseStageInstance.update({
    where: { id: stage.id },
    data: { dueAt: pastDueAt },
  });

  return { admin, template, depot, incident, stageId: stage.id };
}

function trackRule(id: string) {
  cleanup.ruleIds.push(id);
  return id;
}

describe("scanAndFireEscalations", () => {
  it("fires a rule whose threshold has been crossed, creates an EscalationEvent, and calls the email provider", async () => {
    const org = await db.organization.create({
      data: { code: unique("M13"), name: "M13 Scan Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const { admin, template, incident, stageId } =
      await seedBreachedIncidentStage(org);

    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 1,
      notifyRole: "ORG_ADMIN",
    });
    trackRule(rule.id);

    const result = await scanAndFireEscalations(org.id);
    expect(result.breachedStageCount).toBe(1);
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].caseLabel).toBe(incident.incidentNumber);
    expect(result.fired[0].notifiedEmails).toEqual([admin.user.email]);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toEqual([admin.user.email]);

    const event = await db.escalationEvent.findUnique({
      where: {
        caseStageInstanceId_escalationRuleId: {
          caseStageInstanceId: stageId,
          escalationRuleId: rule.id,
        },
      },
    });
    expect(event).not.toBeNull();

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: "EscalationEvent",
        entityId: event!.id,
        action: "CREATE",
      },
    });
    expect(audit).not.toBeNull();
    expect(audit!.sourceChannel).toBe("SYSTEM");
  });

  it("does not re-fire an already-fired rule on a second scan", async () => {
    const org = await db.organization.create({
      data: { code: unique("M13"), name: "M13 Scan Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const { admin, template } = await seedBreachedIncidentStage(org);
    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 1,
      notifyRole: "ORG_ADMIN",
    });
    trackRule(rule.id);

    const first = await scanAndFireEscalations(org.id);
    expect(first.fired).toHaveLength(1);
    const second = await scanAndFireEscalations(org.id);
    expect(second.fired).toHaveLength(0);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("does not fire below the trigger threshold", async () => {
    const org = await db.organization.create({
      data: { code: unique("M13"), name: "M13 Scan Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const { admin, template } = await seedBreachedIncidentStage(org); // 2h overdue
    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 5, // not overdue enough yet
      notifyRole: "ORG_ADMIN",
    });
    trackRule(rule.id);

    const result = await scanAndFireEscalations(org.id);
    expect(result.fired).toHaveLength(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("does not treat an ON_HOLD stage as breached even with a past dueAt", async () => {
    const org = await db.organization.create({
      data: { code: unique("M13"), name: "M13 Scan Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const { admin, template, stageId } = await seedBreachedIncidentStage(org);
    await db.caseStageInstance.update({
      where: { id: stageId },
      data: { status: "ON_HOLD" },
    });
    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 1,
      notifyRole: "ORG_ADMIN",
    });
    trackRule(rule.id);

    const result = await scanAndFireEscalations(org.id);
    expect(result.breachedStageCount).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("skips a non-EMAIL channel rule without recording it as fired", async () => {
    const org = await db.organization.create({
      data: { code: unique("M13"), name: "M13 Scan Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const { admin, template } = await seedBreachedIncidentStage(org);
    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 1,
      notifyRole: "ORG_ADMIN",
      channel: "WHATSAPP",
    });
    trackRule(rule.id);

    const result = await scanAndFireEscalations(org.id);
    expect(result.fired).toHaveLength(0);
    expect(result.skippedNonEmailCount).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("a DEPOT_MANAGER-role rule only notifies that incident's own depot's manager", async () => {
    const org = await db.organization.create({
      data: { code: unique("M13"), name: "M13 Scan Test Org" },
    });
    cleanup.orgIds.push(org.id);
    const { admin, template, depot } = await seedBreachedIncidentStage(org);
    const managerOwnDepot = await userSessionWithRole(
      org,
      depot.id,
      "DEPOT_MANAGER",
    );
    const otherDepot = await db.depot.create({
      data: {
        organizationId: org.id,
        cityId: (
          await db.city.findFirstOrThrow({ where: { organizationId: org.id } })
        ).id,
        code: unique("D2"),
        name: "Other depot",
      },
    });
    cleanup.depotIds.push(otherDepot.id);
    await userSessionWithRole(org, otherDepot.id, "DEPOT_MANAGER"); // must not be notified

    const rule = await createEscalationRule(admin, {
      stageTemplateId: template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 1,
      notifyRole: "DEPOT_MANAGER",
    });
    trackRule(rule.id);

    const result = await scanAndFireEscalations(org.id);
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].notifiedEmails).toEqual([
      managerOwnDepot.user.email,
    ]);
  });

  it("scoping to one org never fires escalations for another org's breaches", async () => {
    const orgA = await db.organization.create({
      data: { code: unique("M13A"), name: "M13 Org A" },
    });
    cleanup.orgIds.push(orgA.id);
    const orgB = await db.organization.create({
      data: { code: unique("M13B"), name: "M13 Org B" },
    });
    cleanup.orgIds.push(orgB.id);

    const a = await seedBreachedIncidentStage(orgA);
    const b = await seedBreachedIncidentStage(orgB);
    const ruleA = await createEscalationRule(a.admin, {
      stageTemplateId: a.template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 1,
      notifyRole: "ORG_ADMIN",
    });
    trackRule(ruleA.id);
    const ruleB = await createEscalationRule(b.admin, {
      stageTemplateId: b.template.id,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 1,
      notifyRole: "ORG_ADMIN",
    });
    trackRule(ruleB.id);

    const result = await scanAndFireEscalations(orgA.id);
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].notifiedEmails).toEqual([a.admin.user.email]);
  });
});
