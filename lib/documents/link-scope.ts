import "server-only";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { assertDepotInScope } from "@/lib/masters/depot-scope";
import { DomainError } from "@/lib/domain-error";
import type {
  LinkedEntityType,
  UserRole,
} from "@/lib/generated/prisma/enums";

// A document's access is governed by whatever it's linked to. M5 only
// knew how to resolve that for VEHICLE and DRIVER; CLAIM, SURVEY,
// REPAIR_JOB, and SETTLEMENT (M19), then INCIDENT (M21, the Incident
// Detail Documents tab), each added a case below once their owning
// module existed. POLICY still has no service layer, so it's left out.
// The DocumentLink schema already supports linking to any of these (see
// docs/schema/M2A.md); this is the resolution piece.
export const SUPPORTED_LINK_TYPES = [
  "VEHICLE",
  "DRIVER",
  "INCIDENT",
  "CLAIM",
  "SURVEY",
  "REPAIR_JOB",
  "SETTLEMENT",
] as const;
export type SupportedLinkType = (typeof SUPPORTED_LINK_TYPES)[number];

// Which roles may create/version documents against each linked entity
// type — mirrors that entity's own module's WRITE_ROLES exactly (e.g. a
// survey report is uploaded by whoever can write a Survey), rather than
// reusing VEHICLE/DRIVER's ORG_ADMIN+DEPOT_MANAGER default, which has no
// bearing on claim sub-records.
const WRITE_ROLES_BY_ENTITY_TYPE: Partial<Record<LinkedEntityType, readonly UserRole[]>> = {
  // Same as DEFAULT_WRITE_ROLES today (lib/incidents/incident.ts's own
  // WRITE_ROLES) — listed explicitly so the mapping stays correct even
  // if the two ever diverge, rather than relying on a coincidental match.
  INCIDENT: ["ORG_ADMIN", "DEPOT_MANAGER"],
  CLAIM: ["ORG_ADMIN", "CLAIMS_MANAGER"],
  SURVEY: ["ORG_ADMIN", "CLAIMS_MANAGER", "SURVEYOR"],
  REPAIR_JOB: ["ORG_ADMIN", "CLAIMS_MANAGER", "WORKSHOP_COORDINATOR"],
  SETTLEMENT: ["ORG_ADMIN", "FINANCE_OFFICER"],
};
const DEFAULT_WRITE_ROLES: readonly UserRole[] = ["ORG_ADMIN", "DEPOT_MANAGER"];

async function resolveDepotId(
  session: AuthSession,
  linkedEntityType: LinkedEntityType,
  linkedEntityId: string,
): Promise<string> {
  const db = scopedDb(session.user.organizationId);
  if (linkedEntityType === "VEHICLE") {
    const vehicle = await db.vehicle.findUniqueOrThrow({
      where: { id: linkedEntityId },
    });
    return vehicle.depotId;
  }
  if (linkedEntityType === "DRIVER") {
    const driver = await db.driver.findUniqueOrThrow({
      where: { id: linkedEntityId },
    });
    return driver.depotId;
  }
  if (linkedEntityType === "INCIDENT") {
    const incident = await db.incident.findUniqueOrThrow({
      where: { id: linkedEntityId },
    });
    return incident.depotId;
  }
  // CLAIM/SURVEY/REPAIR_JOB/SETTLEMENT all resolve their depot the same
  // way: through the claim's incident (a sub-record has no depot of its
  // own). Claim itself is the base case; the rest walk one hop further.
  if (linkedEntityType === "CLAIM") {
    const claim = await db.claim.findUniqueOrThrow({
      where: { id: linkedEntityId },
      include: { incident: true },
    });
    return claim.incident.depotId;
  }
  if (linkedEntityType === "SURVEY") {
    const survey = await db.survey.findUniqueOrThrow({
      where: { id: linkedEntityId },
      include: { claim: { include: { incident: true } } },
    });
    return survey.claim.incident.depotId;
  }
  if (linkedEntityType === "REPAIR_JOB") {
    const repairJob = await db.repairJob.findUniqueOrThrow({
      where: { id: linkedEntityId },
      include: { claim: { include: { incident: true } } },
    });
    return repairJob.claim.incident.depotId;
  }
  if (linkedEntityType === "SETTLEMENT") {
    const settlement = await db.settlement.findUniqueOrThrow({
      where: { id: linkedEntityId },
      include: { claim: { include: { incident: true } } },
    });
    return settlement.claim.incident.depotId;
  }
  throw new DomainError(
    `Document linkage to ${linkedEntityType} isn't supported yet — its owning module hasn't landed.`,
  );
}

/**
 * Throws forbidden() unless the session may create/version documents
 * against this linked entity — the same roles that can write the linked
 * entity itself (WRITE_ROLES_BY_ENTITY_TYPE), falling back to
 * ORG_ADMIN+DEPOT_MANAGER for VEHICLE/DRIVER (mirrors
 * lib/masters/{vehicle,driver}.ts's write RBAC, see docs/MASTERS.md). A
 * DEPOT_MANAGER is further confined to their own depot regardless of
 * entity type.
 */
export async function assertCanManageDocumentsFor(
  session: AuthSession,
  linkedEntityType: LinkedEntityType,
  linkedEntityId: string,
): Promise<void> {
  requireRole(
    session,
    ...(WRITE_ROLES_BY_ENTITY_TYPE[linkedEntityType] ?? DEFAULT_WRITE_ROLES),
  );
  const depotId = await resolveDepotId(
    session,
    linkedEntityType,
    linkedEntityId,
  );
  assertDepotInScope(session, depotId);
}

/**
 * Throws forbidden() unless the session may read documents against this
 * linked entity. No role restriction (every authenticated org member can
 * read), but still depot-scoped for DEPOT_MANAGER — a no-op for every
 * other role, same as lib/masters/{vehicle,driver}.ts's reads.
 */
export async function assertCanReadDocumentsFor(
  session: AuthSession,
  linkedEntityType: LinkedEntityType,
  linkedEntityId: string,
): Promise<void> {
  const depotId = await resolveDepotId(
    session,
    linkedEntityType,
    linkedEntityId,
  );
  assertDepotInScope(session, depotId);
}
