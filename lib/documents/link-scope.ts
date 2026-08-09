import "server-only";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { assertDepotInScope } from "@/lib/masters/depot-scope";
import type { LinkedEntityType } from "@/lib/generated/prisma/enums";

// A document's access is governed by whatever it's linked to. M5 only
// knows how to resolve that for VEHICLE and DRIVER — the only linkable
// entities with a real service/RBAC layer today. INCIDENT (M6), POLICY
// (needs a service layer), CLAIM/SURVEY/REPAIR_JOB (M7+) will each need a
// case added here once their owning module exists; the DocumentLink schema
// already supports linking to them (see docs/schema/M2A.md), this is the
// remaining piece.
export const SUPPORTED_LINK_TYPES = ["VEHICLE", "DRIVER"] as const;
export type SupportedLinkType = (typeof SUPPORTED_LINK_TYPES)[number];

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
  throw new Error(
    `Document linkage to ${linkedEntityType} isn't supported yet — its owning module hasn't landed.`,
  );
}

/**
 * Throws forbidden() unless the session may create/version documents
 * against this linked entity: ORG_ADMIN + DEPOT_MANAGER only, and a
 * DEPOT_MANAGER is further confined to their own depot — mirrors
 * lib/masters/{vehicle,driver}.ts's write RBAC exactly (see docs/MASTERS.md).
 */
export async function assertCanManageDocumentsFor(
  session: AuthSession,
  linkedEntityType: LinkedEntityType,
  linkedEntityId: string,
): Promise<void> {
  requireRole(session, "ORG_ADMIN", "DEPOT_MANAGER");
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
