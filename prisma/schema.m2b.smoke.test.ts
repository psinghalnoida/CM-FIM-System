// Schema smoke test for M2b. Exercises the claims-lifecycle relations
// (policy -> claim -> survey/repair -> TAT stages/holds -> settlement/
// payment) and the two hand-added CHECK constraints (CaseStageInstance and
// ActivityTimelineEvent must have exactly one of incidentId/claimId set)
// against a real Postgres instance.
//
// Requires DATABASE_URL to point at a running Postgres. Everything runs
// inside one transaction that's always rolled back, so it never leaves
// data behind.
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

class IntentionalRollback extends Error {}

async function runAndRollback<T>(
  fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    await db.$transaction(async (tx) => {
      result = await fn(tx);
      throw new IntentionalRollback();
    });
  } catch (err) {
    if (err instanceof IntentionalRollback) {
      return result!;
    }
    throw err;
  }
  throw new Error("unreachable");
}

/** Creates the org/depot/user/vehicle/driver/incident fixtures every test needs. */
async function seedIncident(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
) {
  const org = await tx.organization.create({
    data: {
      code: `TEST-${Date.now()}-${Math.random()}`,
      name: "Test Fleet Org",
    },
  });
  const city = await tx.city.create({
    data: { organizationId: org.id, name: "Gurugram" },
  });
  const depot = await tx.depot.create({
    data: {
      organizationId: org.id,
      cityId: city.id,
      code: "GGN-01",
      name: "Gurugram Depot",
    },
  });
  const user = await tx.user.create({
    data: {
      organizationId: org.id,
      depotId: depot.id,
      name: "Claims Manager",
      email: `cm-${Date.now()}-${Math.random()}@example.com`,
      role: "CLAIMS_MANAGER",
    },
  });
  const vehicle = await tx.vehicle.create({
    data: {
      organizationId: org.id,
      depotId: depot.id,
      registrationNumber: `HR55AB${Math.floor(Math.random() * 10000)}`,
      vehicleType: "TRUCK",
    },
  });
  const incident = await tx.incident.create({
    data: {
      organizationId: org.id,
      incidentNumber: `INC-2026-${Math.floor(Math.random() * 1000000)}`,
      vehicleId: vehicle.id,
      depotId: depot.id,
      incidentDateTime: new Date(),
      incidentType: "ACCIDENT",
      description: "Test incident for M2b smoke test.",
    },
  });
  return { org, depot, user, vehicle, incident };
}

describe("M2b schema", () => {
  it("supports policy -> claim -> survey/repair -> TAT -> settlement/payment", async () => {
    await runAndRollback(async (tx) => {
      const { org, user, vehicle, incident } = await seedIncident(tx);

      // BR-05: the policy an incident-date lookup would find.
      const policy = await tx.insurancePolicy.create({
        data: {
          organizationId: org.id,
          vehicleId: vehicle.id,
          policyNumber: `POL-${Date.now()}`,
          insurerName: "Test Insurer",
          policyType: "COMPREHENSIVE",
          coverageStartDate: new Date("2026-01-01"),
          coverageEndDate: new Date("2026-12-31"),
          premiumAmount: "45000.00",
          sumInsuredAmount: "1500000.00",
        },
      });

      // BR-02/BR-03: claim derived from the incident, referencing the policy.
      const claim = await tx.claim.create({
        data: {
          organizationId: org.id,
          claimNumber: `CLM-2026-${Math.floor(Math.random() * 1000000)}`,
          incidentId: incident.id,
          claimType: "INSURANCE",
          policyId: policy.id,
          assignedToId: user.id,
        },
      });

      const survey = await tx.survey.create({
        data: {
          organizationId: org.id,
          surveyNumber: `SUR-2026-${Math.floor(Math.random() * 1000000)}`,
          claimId: claim.id,
          surveyorName: "External Surveyor Co.",
          status: "SCHEDULED",
        },
      });

      const repairJob = await tx.repairJob.create({
        data: {
          organizationId: org.id,
          claimId: claim.id,
          workshopName: "Test Authorized Workshop",
          estimatedCost: "85000.00",
        },
      });
      await tx.workshopActivity.create({
        data: {
          repairJobId: repairJob.id,
          activityType: "ESTIMATE_SUBMITTED",
          actorId: user.id,
        },
      });

      // TAT engine: stage template -> case stage instance (attached to the
      // claim, not the incident) -> a hold period.
      const stageTemplate = await tx.tatStageTemplate.create({
        data: {
          organizationId: org.id,
          caseType: "INSURANCE_CLAIM",
          stageKey: "SURVEY_SCHEDULING",
          stageName: "Survey Scheduling",
          sequenceOrder: 1,
          targetHours: 24,
        },
      });
      const stageInstance = await tx.caseStageInstance.create({
        data: {
          organizationId: org.id,
          claimId: claim.id,
          stageTemplateId: stageTemplate.id,
          status: "ON_HOLD",
        },
      });
      await tx.tatHoldPeriod.create({
        data: {
          caseStageInstanceId: stageInstance.id,
          reason: "Awaiting driver statement",
          responsibleParty: "DEPOT",
          createdById: user.id,
        },
      });
      await tx.escalationRule.create({
        data: {
          organizationId: org.id,
          stageTemplateId: stageTemplate.id,
          escalationLevel: 1,
          triggerAfterHoursBeyondTat: 12,
          notifyRole: "CLAIMS_MANAGER",
        },
      });

      // Claim-scoped timeline event (the M2b addition to ActivityTimelineEvent).
      await tx.activityTimelineEvent.create({
        data: {
          claimId: claim.id,
          eventType: "STATUS_CHANGE",
          actorId: user.id,
          description: "Claim opened.",
        },
      });

      // BR-09: settlement + payment, checked before closure (by the
      // domain-settlement service, not the schema).
      const settlement = await tx.settlement.create({
        data: {
          organizationId: org.id,
          claimId: claim.id,
          settlementAmount: "80000.00",
          status: "ACCEPTED",
          respondedById: user.id,
          respondedAt: new Date(),
        },
      });
      await tx.payment.create({
        data: {
          settlementId: settlement.id,
          amount: "80000.00",
          paymentDate: new Date(),
          paymentMethod: "BANK_TRANSFER",
          reconciled: true,
          reconciledAt: new Date(),
          reconciledById: user.id,
        },
      });

      const fetched = await tx.claim.findUniqueOrThrow({
        where: { id: claim.id },
        include: {
          policy: true,
          surveys: true,
          repairJobs: { include: { activities: true } },
          caseStageInstances: { include: { holdPeriods: true } },
          settlements: { include: { payments: true } },
          timelineEvents: true,
        },
      });

      expect(fetched.policy?.policyNumber).toBe(policy.policyNumber);
      expect(fetched.surveys).toHaveLength(1);
      expect(survey.surveyNumber).toMatch(/^SUR-\d{4}-\d+$/);
      expect(fetched.repairJobs[0]?.activities).toHaveLength(1);
      expect(fetched.caseStageInstances[0]?.holdPeriods).toHaveLength(1);
      expect(fetched.settlements[0]?.payments).toHaveLength(1);
      expect(fetched.settlements[0]?.currency).toBe("INR");
      expect(fetched.timelineEvents).toHaveLength(1);

      return null;
    });
  });

  it("rejects a CaseStageInstance with both incidentId and claimId set", async () => {
    await runAndRollback(async (tx) => {
      const { org, incident } = await seedIncident(tx);
      const claim = await tx.claim.create({
        data: {
          organizationId: org.id,
          claimNumber: `CLM-2026-${Math.floor(Math.random() * 1000000)}`,
          incidentId: incident.id,
          claimType: "MAINTENANCE",
        },
      });
      const stageTemplate = await tx.tatStageTemplate.create({
        data: {
          organizationId: org.id,
          caseType: "MAINTENANCE_CLAIM",
          stageKey: "TEST_STAGE",
          stageName: "Test Stage",
          sequenceOrder: 1,
          targetHours: 24,
        },
      });

      await expect(
        tx.caseStageInstance.create({
          data: {
            organizationId: org.id,
            incidentId: incident.id,
            claimId: claim.id, // both set — should violate the CHECK constraint
            stageTemplateId: stageTemplate.id,
          },
        }),
      ).rejects.toThrow();

      await expect(
        tx.caseStageInstance.create({
          data: {
            organizationId: org.id,
            // neither set — should also violate the CHECK constraint
            stageTemplateId: stageTemplate.id,
          },
        }),
      ).rejects.toThrow();

      return null;
    });
  });

  it("rejects an ActivityTimelineEvent with neither incidentId nor claimId set", async () => {
    await runAndRollback(async (tx) => {
      await expect(
        tx.activityTimelineEvent.create({
          data: {
            eventType: "NOTE",
            description: "Should fail: no subject.",
          },
        }),
      ).rejects.toThrow();

      return null;
    });
  });
});
