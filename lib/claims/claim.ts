import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope, depotScopeFor } from "@/lib/masters/depot-scope";
import { DomainError } from "@/lib/domain-error";
import { instantiateStagesForCase } from "@/lib/tat/case-stage";
import { assertClaimSettlementSatisfied } from "@/lib/settlements/settlement";
import { ClaimType, ClaimStatus, CaseType } from "@/lib/generated/prisma/enums";

// M8: every ClaimType maps to a CaseType one-to-one (the enums mirror
// each other, "_CLAIM" suffix) — this is what instantiateStagesForCase
// keys TAT stage-template lookup on. See docs/TAT.md.
const CASE_TYPE_BY_CLAIM_TYPE: Record<ClaimType, CaseType> = {
  INSURANCE: CaseType.INSURANCE_CLAIM,
  WARRANTY: CaseType.WARRANTY_CLAIM,
  MAINTENANCE: CaseType.MAINTENANCE_CLAIM,
  OPERATIONAL: CaseType.OPERATIONAL_CLAIM,
  THIRD_PARTY_RECOVERY: CaseType.THIRD_PARTY_RECOVERY_CLAIM,
  MIXED: CaseType.MIXED_CLAIM,
};

// M7: a Claim is filed against an existing Incident (BR-01 — the incident
// is never re-created). An incident can spawn any number of claims (e.g.
// an own-damage insurance claim and a separate third-party-recovery
// claim from the same accident) — nothing here limits it to one. See
// docs/CLAIMS.md.

const WRITE_ROLES = ["ORG_ADMIN", "CLAIMS_MANAGER"] as const;

// Claims aren't depot-scoped for their write roles: CLAIMS_MANAGER (like
// SURVEYOR/WORKSHOP_COORDINATOR) needs cross-depot visibility to do its
// job, same reasoning lib/masters/depot-scope.ts already documents for
// master-data reads. Only DEPOT_MANAGER — who has no write access to
// claims at all — is depot-confined, and only for reads (below).

export const CreateClaimSchema = z.object({
  incidentId: z.uuid(),
  claimType: z.enum(ClaimType),
  assignedToId: z.uuid().optional(),
});
export type CreateClaimInput = z.infer<typeof CreateClaimSchema>;

export const UpdateClaimSchema = z.object({
  assignedToId: z.uuid().nullable().optional(),
});
export type UpdateClaimInput = z.infer<typeof UpdateClaimSchema>;

/**
 * The full claim lifecycle. BR-09 ("no final closure without settlement")
 * is deliberately NOT enforced here — the schema/M2B doc says that check
 * belongs to the domain-settlement logic, and Settlement/Payment recording
 * doesn't exist yet (M14). SETTLED -> CLOSED is reachable administratively
 * today, same as M6's incident closure had no claim-aware check at the
 * time it was built. Revisit this map when M14 lands.
 */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  OPEN: ["UNDER_SURVEY", "REJECTED"],
  UNDER_SURVEY: ["UNDER_REPAIR", "REJECTED"],
  UNDER_REPAIR: ["PENDING_SETTLEMENT", "REJECTED"],
  PENDING_SETTLEMENT: ["SETTLED", "REJECTED"],
  SETTLED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
};

/**
 * INC-YYYY-######'s sibling for claims (docs/schema/M2A.md's IdCounter
 * pattern) — see lib/incidents/incident.ts's generateIncidentNumber for
 * why the counter increment and the insert share one transaction.
 */
async function generateClaimNumber(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  organizationId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await tx.idCounter.upsert({
    where: {
      organizationId_entityType_year: {
        organizationId,
        entityType: "CLAIM",
        year,
      },
    },
    create: { organizationId, entityType: "CLAIM", year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `CLM-${year}-${String(counter.lastNumber).padStart(6, "0")}`;
}

/**
 * BR-05: the policy whose coverage window contains the incident date, for
 * this vehicle. Only called for INSURANCE/MIXED claims — every other
 * claim type has no policy. Returns null (not an error) when nothing
 * matches; see docs/CLAIMS.md for why creation isn't blocked on this.
 */
async function selectPolicyForClaim(
  scoped: ReturnType<typeof scopedDb>,
  vehicleId: string,
  incidentDateTime: Date,
) {
  return scoped.insurancePolicy.findFirst({
    where: {
      vehicleId,
      coverageStartDate: { lte: incidentDateTime },
      coverageEndDate: { gte: incidentDateTime },
    },
    orderBy: { coverageStartDate: "desc" },
  });
}

export async function createClaim(session: AuthSession, input: unknown) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateClaimSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const incident = await scoped.incident.findUniqueOrThrow({
    where: { id: data.incidentId },
  });

  if (data.assignedToId) {
    await scoped.user.findUniqueOrThrow({ where: { id: data.assignedToId } });
  }

  let policyId: string | null = null;
  if (
    data.claimType === ClaimType.INSURANCE ||
    data.claimType === ClaimType.MIXED
  ) {
    const policy = await selectPolicyForClaim(
      scoped,
      incident.vehicleId,
      incident.incidentDateTime,
    );
    policyId = policy?.id ?? null;
  }

  const claim = await db.$transaction(async (tx) => {
    const claimNumber = await generateClaimNumber(
      tx,
      session.user.organizationId,
    );
    const created = await tx.claim.create({
      data: {
        organizationId: session.user.organizationId,
        claimNumber,
        incidentId: data.incidentId,
        claimType: data.claimType,
        policyId,
        assignedToId: data.assignedToId,
      },
    });
    // M8: auto-instantiate this org's configured TAT stages for this
    // claim's case type (a no-op if none are configured yet).
    await instantiateStagesForCase(
      tx,
      session.user.organizationId,
      CASE_TYPE_BY_CLAIM_TYPE[data.claimType],
      { claimId: created.id },
    );
    return created;
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Claim",
    entityId: claim.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: claim,
    sourceChannel: "WEB",
  });

  return claim;
}

export async function updateClaim(
  session: AuthSession,
  id: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = UpdateClaimSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.claim.findUniqueOrThrow({ where: { id } });
  if (data.assignedToId) {
    await scoped.user.findUniqueOrThrow({ where: { id: data.assignedToId } });
  }

  const claim = await scoped.claim.update({ where: { id }, data });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Claim",
    entityId: claim.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: before,
    afterData: claim,
    sourceChannel: "WEB",
  });

  return claim;
}

export async function transitionClaimStatus(
  session: AuthSession,
  id: string,
  to: ClaimStatus,
) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.claim.findUniqueOrThrow({ where: { id } });
  const allowed = CLAIM_TRANSITIONS[before.status];
  if (!allowed.includes(to)) {
    throw new DomainError(
      `Cannot transition a claim from ${before.status} to ${to}.`,
      409,
    );
  }

  // BR-09: the one place M7 deliberately left unenforced ("no claim-aware
  // checks yet... revisit when M14 lands" — docs/CLAIMS.md). Every other
  // transition needs no financial gate; only reaching CLOSED does.
  if (to === ClaimStatus.CLOSED) {
    await assertClaimSettlementSatisfied(session.user.organizationId, id);
  }

  const claim = await scoped.claim.update({
    where: { id },
    data: {
      status: to,
      closedAt: to === ClaimStatus.CLOSED ? new Date() : undefined,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Claim",
    entityId: claim.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: claim.status },
    sourceChannel: "WEB",
  });

  return claim;
}

export async function getClaim(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  const claim = await scoped.claim.findUnique({
    where: { id },
    include: {
      incident: true,
      policy: { include: { insurer: true, broker: true } },
      assignedTo: true,
      surveys: { include: { surveyor: true } },
      repairJobs: { include: { workshop: true } },
    },
  });
  if (!claim) return null;
  assertDepotInScope(session, claim.incident.depotId);
  return claim;
}

export interface ListClaimsFilter {
  status?: ClaimStatus;
  incidentId?: string;
}

/** DEPOT_MANAGER only sees claims on incidents at their own depot; other roles see the whole org. */
export async function listClaims(
  session: AuthSession,
  filter: ListClaimsFilter = {},
) {
  const scoped = scopedDb(session.user.organizationId);
  const depotScope = depotScopeFor(session);
  return scoped.claim.findMany({
    where: {
      status: filter.status,
      incidentId: filter.incidentId,
      incident: depotScope ? { depotId: depotScope } : undefined,
    },
    include: { incident: true, policy: true },
    orderBy: { openedAt: "desc" },
  });
}
