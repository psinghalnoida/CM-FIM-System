// Realistic JBM demonstration dataset (M15) — masters data across three
// depots, one user per role, TAT stage templates + escalation rules for
// both case types the demo walks through, and a handful of
// incidents/claims spanning every stage of the lifecycle (including one
// fully CLOSED claim with a reconciled settlement) so the app has
// something real to look at on first login. Superseded the M1-era
// "just enough to log in" seed — see docs/DEPLOYMENT.md.
//
// Goes through the real service-layer functions (createIncident,
// createClaim, transitionClaimStatus, ...) rather than raw db.*.create()
// calls wherever one exists, so seeded data gets real audit-log entries,
// real ID generation, and real TAT stage auto-instantiation — not a
// parallel, drifting reimplementation of that logic. Those service
// modules carry the "server-only" guard (correctly — they're app-only
// code), which throws when required outside Next's build; running this
// script needs scripts/server-only-shim.cjs, wired in via package.json's
// db:seed script. Never run against a production database: every user's
// password is a fixed, publicly-known dev default.
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import type { AuthSession } from "@/lib/dal";
import { createDepot } from "@/lib/masters/depot";
import { createDriver } from "@/lib/masters/driver";
import { createVehicle } from "@/lib/masters/vehicle";
import { createIncident } from "@/lib/incidents/incident";
import { createClaim, transitionClaimStatus } from "@/lib/claims/claim";
import { createSurvey, transitionSurveyStatus } from "@/lib/claims/survey";
import {
  createRepairJob,
  transitionRepairJobStatus,
} from "@/lib/claims/repair-job";
import { createStageTemplate } from "@/lib/tat/stage-template";
import { createEscalationRule } from "@/lib/escalations/escalation-rule";
import {
  createSettlement,
  approveSettlement,
} from "@/lib/settlements/settlement";
import { createPayment, reconcilePayment } from "@/lib/settlements/payment";
import type { UserRole } from "@/lib/generated/prisma/enums";

const DEV_PASSWORD = "ChangeMe123!";

const ROLE_USERS: { role: UserRole; email: string; name: string }[] = [
  { role: "ORG_ADMIN", email: "admin@jbm.example", name: "JBM Admin" },
  {
    role: "DEPOT_MANAGER",
    email: "depot.ggn@jbm.example",
    name: "Gurugram Depot Manager",
  },
  {
    role: "CLAIMS_MANAGER",
    email: "claims@jbm.example",
    name: "Claims Manager",
  },
  { role: "SURVEYOR", email: "surveyor@jbm.example", name: "Staff Surveyor" },
  {
    role: "WORKSHOP_COORDINATOR",
    email: "workshop@jbm.example",
    name: "Workshop Coordinator",
  },
  {
    role: "FINANCE_OFFICER",
    email: "finance@jbm.example",
    name: "Finance Officer",
  },
  { role: "AUDITOR", email: "auditor@jbm.example", name: "Auditor" },
];

/** Builds an AuthSession-shaped object for calling service functions directly, matching the pattern used across every lib/**\/*.integration.test.ts file. */
function sessionFor(user: {
  id: string;
  organizationId: string;
  role: UserRole;
  [key: string]: unknown;
}): AuthSession {
  return {
    id: "seed-session",
    userId: user.id,
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    createdAt: new Date(),
    user,
  } as AuthSession;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run the dev seed against NODE_ENV=production.",
    );
  }

  const org = await db.organization.upsert({
    where: { code: "JBM" },
    create: { code: "JBM", name: "JBM Group" },
    update: {},
  });

  const passwordHash = await hashPassword(DEV_PASSWORD);
  const usersByRole = new Map<
    UserRole,
    Awaited<ReturnType<typeof upsertUser>>
  >();

  async function upsertUser(email: string, name: string, role: UserRole) {
    return db.user.upsert({
      where: { email },
      create: {
        organizationId: org.id,
        name,
        email,
        passwordHash,
        role,
      },
      update: { passwordHash },
    });
  }

  for (const { role, email, name } of ROLE_USERS) {
    usersByRole.set(role, await upsertUser(email, name, role));
  }
  const admin = usersByRole.get("ORG_ADMIN")!;
  const adminSession = sessionFor(admin);
  const claimsManagerSession = sessionFor(usersByRole.get("CLAIMS_MANAGER")!);
  const surveyorSession = sessionFor(usersByRole.get("SURVEYOR")!);
  const workshopSession = sessionFor(usersByRole.get("WORKSHOP_COORDINATOR")!);
  const financeSession = sessionFor(usersByRole.get("FINANCE_OFFICER")!);

  // --- Cities/depots (three, matching JBM's real footprint pattern) ---
  const cityDefs = [
    {
      name: "Gurugram",
      state: "Haryana",
      depotCode: "GGN-01",
      depotName: "Gurugram Depot",
    },
    {
      name: "Chennai",
      state: "Tamil Nadu",
      depotCode: "MAA-01",
      depotName: "Chennai Depot",
    },
    {
      name: "Pune",
      state: "Maharashtra",
      depotCode: "PNQ-01",
      depotName: "Pune Depot",
    },
  ];
  const depots: { id: string; cityName: string }[] = [];
  for (const def of cityDefs) {
    const city = await db.city.upsert({
      where: {
        organizationId_name: { organizationId: org.id, name: def.name },
      },
      create: { organizationId: org.id, name: def.name, state: def.state },
      update: {},
    });
    let depot = await db.depot.findUnique({
      where: {
        organizationId_code: { organizationId: org.id, code: def.depotCode },
      },
    });
    if (!depot) {
      depot = await createDepot(adminSession, {
        cityId: city.id,
        code: def.depotCode,
        name: def.depotName,
      });
    }
    depots.push({ id: depot.id, cityName: def.name });
  }
  const ggnDepotId = depots[0].id;

  // Attach the depot manager to the Gurugram depot (created without one above).
  await db.user.update({
    where: { id: usersByRole.get("DEPOT_MANAGER")!.id },
    data: { depotId: ggnDepotId },
  });

  // --- Drivers + vehicles, a couple per depot ---
  const vehicleIds: string[] = [];
  let driverSeq = 0;
  let vehicleSeq = 0;
  for (const depot of depots) {
    for (let i = 0; i < 2; i += 1) {
      driverSeq += 1;
      const licenseNumber = `DL-${String(driverSeq).padStart(4, "0")}`;
      const existingDriver = await db.driver.findFirst({
        where: { organizationId: org.id, licenseNumber },
      });
      if (!existingDriver) {
        await createDriver(adminSession, {
          depotId: depot.id,
          name: `Driver ${driverSeq}`,
          licenseNumber,
          phone: `9${String(700000000 + driverSeq)}`,
        });
      }

      vehicleSeq += 1;
      const registrationNumber = `HR${55 + vehicleSeq}AB${1000 + vehicleSeq}`;
      let vehicle = await db.vehicle.findFirst({
        where: { organizationId: org.id, registrationNumber },
      });
      if (!vehicle) {
        vehicle = await createVehicle(adminSession, {
          depotId: depot.id,
          registrationNumber,
          make: "Tata",
          model: "LPT 1618",
          vehicleType: "TRUCK",
          manufactureYear: 2021,
        });
      }
      vehicleIds.push(vehicle.id);
    }
  }
  // One vehicle from each depot (2 vehicles seeded per depot above, in
  // depot order) — index 0/2/4 picks the first vehicle at each of the
  // three depots respectively.
  const vehicleAId = vehicleIds[0]; // Gurugram
  const vehicleBId = vehicleIds[2]; // Chennai
  const vehicleCId = vehicleIds[4]; // Pune

  // One active comprehensive policy on the first vehicle, covering the
  // whole current year — BR-05 auto-selects it for INSURANCE claims.
  const yearStart = new Date(`${new Date().getFullYear()}-01-01T00:00:00Z`);
  const yearEnd = new Date(`${new Date().getFullYear()}-12-31T23:59:59Z`);
  await db.insurancePolicy.upsert({
    where: {
      organizationId_policyNumber: {
        organizationId: org.id,
        policyNumber: "POL-2026-0001",
      },
    },
    create: {
      organizationId: org.id,
      vehicleId: vehicleAId,
      policyNumber: "POL-2026-0001",
      insurerName: "ICICI Lombard",
      policyType: "COMPREHENSIVE",
      coverageStartDate: yearStart,
      coverageEndDate: yearEnd,
      premiumAmount: 45000,
      sumInsuredAmount: 1500000,
    },
    update: {},
  });

  // --- TAT stage templates: INCIDENT and INSURANCE_CLAIM case types ---
  const incidentStages: [string, string, number, number][] = [
    ["REPORTED", "Reported", 0, 2],
    ["ASSESSMENT", "Initial assessment", 1, 24],
  ];
  const claimStages: [string, string, number, number][] = [
    ["SURVEY", "Survey", 0, 48],
    ["REPAIR", "Repair", 1, 168],
    ["SETTLEMENT", "Settlement", 2, 72],
  ];
  async function ensureStageTemplate(
    caseType: "INCIDENT" | "INSURANCE_CLAIM",
    [stageKey, stageName, sequenceOrder, targetHours]: [
      string,
      string,
      number,
      number,
    ],
  ) {
    const existing = await db.tatStageTemplate.findUnique({
      where: {
        organizationId_caseType_stageKey: {
          organizationId: org.id,
          caseType,
          stageKey,
        },
      },
    });
    if (existing) return existing;
    return createStageTemplate(adminSession, {
      caseType,
      stageKey,
      stageName,
      sequenceOrder,
      targetHours,
    });
  }
  const seededIncidentStages = [];
  for (const s of incidentStages)
    seededIncidentStages.push(await ensureStageTemplate("INCIDENT", s));
  const seededClaimStages = [];
  for (const s of claimStages)
    seededClaimStages.push(await ensureStageTemplate("INSURANCE_CLAIM", s));

  // One escalation rule per case type, notifying ORG_ADMIN if a stage
  // runs 24h past its target.
  async function ensureEscalationRule(stageTemplateId: string) {
    const existing = await db.escalationRule.findFirst({
      where: { organizationId: org.id, stageTemplateId, escalationLevel: 1 },
    });
    if (existing) return existing;
    return createEscalationRule(adminSession, {
      stageTemplateId,
      escalationLevel: 1,
      triggerAfterHoursBeyondTat: 24,
      notifyRole: "ORG_ADMIN",
      channel: "EMAIL",
    });
  }
  await ensureEscalationRule(seededIncidentStages[0].id);
  await ensureEscalationRule(seededClaimStages[2].id);

  // --- Sample incidents/claims across the lifecycle ---

  // 1) A fully closed INSURANCE claim: OPEN -> ... -> CLOSED, with an
  //    approved, fully-paid, reconciled settlement (BR-09).
  const closedIncident = await findOrCreateIncident(adminSession, {
    tag: "seed-closed",
    vehicleId: vehicleAId,
    incidentType: "ACCIDENT",
    severity: "HIGH",
    description: "Rear-end collision on NH-48 near the Gurugram toll plaza.",
    daysAgo: 20,
  });
  let closedClaim = await findClaimByIncident(closedIncident.id);
  if (!closedClaim) {
    closedClaim = await createClaim(claimsManagerSession, {
      incidentId: closedIncident.id,
      claimType: "INSURANCE",
    });
    await createSurvey(surveyorSession, {
      claimId: closedClaim.id,
      surveyorName: "Ramesh Iyer",
      surveyorContact: "9812345678",
    });
    await transitionClaimStatus(
      claimsManagerSession,
      closedClaim.id,
      "UNDER_SURVEY",
    );
    const survey = await db.survey.findFirstOrThrow({
      where: { claimId: closedClaim.id },
    });
    await transitionSurveyStatus(surveyorSession, survey.id, "IN_PROGRESS");
    await transitionSurveyStatus(surveyorSession, survey.id, "COMPLETED");

    await createRepairJob(workshopSession, {
      claimId: closedClaim.id,
      workshopName: "JBM Authorized Workshop, Gurugram",
      estimatedCost: 85000,
    });
    await transitionClaimStatus(
      claimsManagerSession,
      closedClaim.id,
      "UNDER_REPAIR",
    );
    const repairJob = await db.repairJob.findFirstOrThrow({
      where: { claimId: closedClaim.id },
    });
    await transitionRepairJobStatus(workshopSession, repairJob.id, "APPROVED");
    await transitionRepairJobStatus(
      workshopSession,
      repairJob.id,
      "IN_PROGRESS",
    );
    await transitionRepairJobStatus(workshopSession, repairJob.id, "COMPLETED");

    await transitionClaimStatus(
      claimsManagerSession,
      closedClaim.id,
      "PENDING_SETTLEMENT",
    );
    await transitionClaimStatus(
      claimsManagerSession,
      closedClaim.id,
      "SETTLED",
    );

    const settlement = await createSettlement(financeSession, {
      claimId: closedClaim.id,
      settlementAmount: 85000,
    });
    await approveSettlement(financeSession, settlement.id);
    const payment = await createPayment(financeSession, {
      settlementId: settlement.id,
      amount: 85000,
      paymentDate: new Date(),
      paymentReference: "NEFT-SEED-0001",
    });
    await reconcilePayment(financeSession, payment.id);

    closedClaim = await transitionClaimStatus(
      claimsManagerSession,
      closedClaim.id,
      "CLOSED",
    );
  }

  // 2) An INSURANCE claim mid-flight: UNDER_SURVEY, survey scheduled but
  //    not yet completed — shows an in-progress TAT stage.
  const inProgressIncident = await findOrCreateIncident(adminSession, {
    tag: "seed-in-progress",
    vehicleId: vehicleBId,
    incidentType: "THIRD_PARTY_DAMAGE",
    severity: "MEDIUM",
    description:
      "Side mirror and door panel damage from a parking-lot collision.",
    daysAgo: 2,
  });
  let inProgressClaim = await findClaimByIncident(inProgressIncident.id);
  if (!inProgressClaim) {
    inProgressClaim = await createClaim(claimsManagerSession, {
      incidentId: inProgressIncident.id,
      claimType: "INSURANCE",
    });
    await createSurvey(surveyorSession, {
      claimId: inProgressClaim.id,
      surveyorName: "Priya Nair",
      surveyorContact: "9823456789",
    });
    inProgressClaim = await transitionClaimStatus(
      claimsManagerSession,
      inProgressClaim.id,
      "UNDER_SURVEY",
    );
  }

  // 3) A bare OPEN incident with no claim yet — the most common state,
  //    freshly reported.
  await findOrCreateIncident(adminSession, {
    tag: "seed-fresh",
    vehicleId: vehicleCId,
    incidentType: "BREAKDOWN",
    severity: "LOW",
    description:
      "Engine overheating reported by driver en route to Pune depot.",
    daysAgo: 0,
  });

  // 4) A MAINTENANCE claim with no settlement path at all, closed
  //    directly — demonstrates BR-09's "no settlements ever recorded"
  //    case (docs/PAYMENTS.md).
  const maintenanceIncident = await findOrCreateIncident(adminSession, {
    tag: "seed-maintenance",
    vehicleId: vehicleAId,
    incidentType: "OTHER",
    severity: "LOW",
    description:
      "Scheduled preventive maintenance flagged an unexpected brake issue.",
    daysAgo: 10,
  });
  let maintenanceClaim = await findClaimByIncident(maintenanceIncident.id);
  if (!maintenanceClaim) {
    maintenanceClaim = await createClaim(claimsManagerSession, {
      incidentId: maintenanceIncident.id,
      claimType: "MAINTENANCE",
    });
    await transitionClaimStatus(
      claimsManagerSession,
      maintenanceClaim.id,
      "UNDER_SURVEY",
    );
    await transitionClaimStatus(
      claimsManagerSession,
      maintenanceClaim.id,
      "UNDER_REPAIR",
    );
    await transitionClaimStatus(
      claimsManagerSession,
      maintenanceClaim.id,
      "PENDING_SETTLEMENT",
    );
    await transitionClaimStatus(
      claimsManagerSession,
      maintenanceClaim.id,
      "SETTLED",
    );
    maintenanceClaim = await transitionClaimStatus(
      claimsManagerSession,
      maintenanceClaim.id,
      "CLOSED",
    );
  }

  console.log("Seeded JBM demo dataset:");
  console.log(`  Organization: ${org.name} (${org.code})`);
  console.log(
    `  Depots:       ${depots.length} across ${cityDefs.map((c) => c.name).join(", ")}`,
  );
  console.log(`  Vehicles:     ${vehicleIds.length}`);
  console.log("  Logins (all use the same dev password):");
  for (const { role, email } of ROLE_USERS) {
    console.log(`    ${email.padEnd(24)} ${role.padEnd(22)} / ${DEV_PASSWORD}`);
  }
  console.log("  Sample claims:");
  console.log(
    `    ${closedClaim.claimNumber}  INSURANCE, CLOSED (settled + reconciled)`,
  );
  console.log(`    ${inProgressClaim.claimNumber}  INSURANCE, UNDER_SURVEY`);
  console.log(
    `    ${maintenanceClaim.claimNumber}  MAINTENANCE, CLOSED (no settlement)`,
  );
}

async function findClaimByIncident(incidentId: string) {
  return db.claim.findFirst({ where: { incidentId } });
}

async function findOrCreateIncident(
  session: AuthSession,
  opts: {
    tag: string;
    vehicleId: string;
    incidentType: Parameters<typeof createIncident>[1]["incidentType"];
    severity: Parameters<typeof createIncident>[1]["severity"];
    description: string;
    daysAgo: number;
  },
) {
  // Seed incidents are tagged with a fixed marker in their description so
  // re-running the seed is idempotent without needing a real unique
  // constraint (createIncident generates its own INC-YYYY-######
  // number, so we can't upsert on that).
  const marker = `[seed:${opts.tag}]`;
  const existing = await db.incident.findFirst({
    where: {
      organizationId: session.user.organizationId,
      description: { endsWith: marker },
    },
  });
  if (existing) return existing;

  const incidentDateTime = new Date(
    Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000,
  );
  return createIncident(session, {
    vehicleId: opts.vehicleId,
    incidentDateTime,
    incidentType: opts.incidentType,
    severity: opts.severity,
    description: `${opts.description} ${marker}`,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
