import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { assertDepotInScope } from "@/lib/masters/depot-scope";

// M20: the Claim Detail "Communication" tab — manually-entered notes
// about correspondence with the insurer/surveyor/workshop, distinct from
// the "Audit" tab (system-generated AuditLog entries for CRUD/status
// actions). Backed by ActivityTimelineEvent, a model that's existed
// since M2b (eventType "NOTE" is literally in its own doc comment as an
// anticipated value) but had no service layer or UI until now — same
// shape as M19's WorkshopActivity/Survey.findings: reusing dormant
// schema rather than adding a new model. See docs/CLAIMS.md.

const WRITE_ROLES = ["ORG_ADMIN", "CLAIMS_MANAGER"] as const;

/** Resolves a claim through the org-scoped client and checks depot scope via its parent incident — same pattern as survey.ts/repair-job.ts. */
async function assertClaimAccessible(session: AuthSession, claimId: string) {
  const scoped = scopedDb(session.user.organizationId);
  const claim = await scoped.claim.findUniqueOrThrow({
    where: { id: claimId },
    include: { incident: true },
  });
  assertDepotInScope(session, claim.incident.depotId);
  return claim;
}

export const AddClaimCommunicationSchema = z.object({
  description: z.string().trim().min(1).max(2000),
});
export type AddClaimCommunicationInput = z.infer<
  typeof AddClaimCommunicationSchema
>;

export async function addClaimCommunication(
  session: AuthSession,
  claimId: string,
  input: unknown,
) {
  requireRole(session, ...WRITE_ROLES);
  const data = AddClaimCommunicationSchema.parse(input);
  await assertClaimAccessible(session, claimId);

  // No recordAudit() call here, deliberately: this entry *is* the
  // record — a "STATUS_CHANGE"-shaped audit entry for the act of typing
  // a note would just be noise alongside the note itself.
  return db.activityTimelineEvent.create({
    data: {
      claimId,
      eventType: "NOTE",
      actorId: session.user.id,
      description: data.description,
    },
  });
}

// Not filtered to eventType "NOTE" — ActivityTimelineEvent's own doc
// comment anticipates other event types (e.g. a future WHATSAPP_MESSAGE
// from M10) landing in the same claim timeline; today NOTE is the only
// writer, but the read side shouldn't assume that stays true.
export async function listClaimCommunications(
  session: AuthSession,
  claimId: string,
) {
  await assertClaimAccessible(session, claimId);
  return db.activityTimelineEvent.findMany({
    where: { claimId },
    include: { actor: true },
    orderBy: { occurredAt: "asc" },
  });
}
