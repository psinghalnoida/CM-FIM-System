import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/domain-error";
import { SettlementStatus } from "@/lib/generated/prisma/enums";

// M14: settlement recording; M19: reworked to record JBM's *response* to
// the insurer's settlement offer, not a financial approval decision — JBM
// is the insured, not an approving authority (the insurer settles the
// claim, the surveyor recommends the loss). BR-09's closure gate checks
// every settlement on the claim, not just the most recent one — a claim
// can have multiple settlements (interim + final), see
// docs/schema/M2B.md. See docs/PAYMENTS.md.

const WRITE_ROLES = ["ORG_ADMIN", "FINANCE_OFFICER"] as const;

// Money comparisons are rounded to the cent before comparing — Decimal
// values pass through JS numbers here (fine at this scale/precision;
// this isn't a system doing sub-cent arithmetic), but repeated
// addition can still drift by a fraction of a cent, which would
// otherwise make an exactly-paid settlement compare as unequal.
function toCents(value: unknown): number {
  return Math.round(Number(value) * 100);
}

export const CreateSettlementSchema = z.object({
  claimId: z.uuid(),
  settlementAmount: z.number().positive(),
  currency: z.string().trim().length(3).optional(),
});
export type CreateSettlementInput = z.infer<typeof CreateSettlementSchema>;

export async function createSettlement(session: AuthSession, input: unknown) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreateSettlementSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);

  await scoped.claim.findUniqueOrThrow({ where: { id: data.claimId } });

  const settlement = await scoped.settlement.create({
    data: {
      organizationId: session.user.organizationId,
      claimId: data.claimId,
      settlementAmount: data.settlementAmount,
      currency: data.currency ?? "INR",
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Settlement",
    entityId: settlement.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: settlement,
    sourceChannel: "WEB",
  });

  return settlement;
}

/**
 * Records JBM's response to the insurer's settlement offer. PENDING,
 * DISPUTED, and REVIEW_REQUESTED can all move to any of the three
 * response states — JBM's position can change as a dispute/review plays
 * out with the insurer. ACCEPTED is terminal: once JBM has accepted an
 * offer (the trigger for recording payments against it, BR-09), that
 * decision doesn't get walked back through this endpoint.
 */
async function transitionSettlementStatus(
  session: AuthSession,
  id: string,
  to: SettlementStatus,
) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.settlement.findUniqueOrThrow({ where: { id } });
  if (before.status === SettlementStatus.ACCEPTED) {
    throw new DomainError(
      "This settlement has already been accepted — its response cannot be changed.",
      409,
    );
  }

  const settlement = await scoped.settlement.update({
    where: { id },
    data: {
      status: to,
      respondedById: session.user.id,
      respondedAt: new Date(),
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Settlement",
    entityId: settlement.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: before.status },
    afterData: { status: settlement.status },
    sourceChannel: "WEB",
  });

  return settlement;
}

/** JBM accepts the insurer's settlement offer as-is. */
export async function acceptSettlement(session: AuthSession, id: string) {
  return transitionSettlementStatus(session, id, SettlementStatus.ACCEPTED);
}

/** JBM disputes/raises a concern about the insurer's settlement offer. */
export async function disputeSettlement(session: AuthSession, id: string) {
  return transitionSettlementStatus(session, id, SettlementStatus.DISPUTED);
}

/** JBM asks the insurer to review the settlement offer before deciding. */
export async function requestSettlementReview(
  session: AuthSession,
  id: string,
) {
  return transitionSettlementStatus(
    session,
    id,
    SettlementStatus.REVIEW_REQUESTED,
  );
}

export async function getSettlement(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  return scoped.settlement.findUnique({
    where: { id },
    include: { payments: true, claim: true },
  });
}

export async function listSettlementsForClaim(
  session: AuthSession,
  claimId: string,
) {
  const scoped = scopedDb(session.user.organizationId);
  await scoped.claim.findUniqueOrThrow({ where: { id: claimId } });
  return scoped.settlement.findMany({
    where: { claimId },
    include: { payments: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * BR-09: throws unless every settlement on this claim has been ACCEPTED
 * by JBM, its payments sum to the settlement amount, and every payment
 * is reconciled. There's no excluded/ignorable settlement status —
 * unlike the pre-M19 model's REJECTED, JBM can't unilaterally remove a
 * settlement from consideration; every insurer offer needs a resolved
 * response before the claim can close. Called from lib/claims/claim.ts's
 * transitionClaimStatus() on the SETTLED -> CLOSED transition — this
 * function has no RBAC/session of its own since it's a pure gate check,
 * not an action; the caller already checked write access.
 */
export async function assertClaimSettlementSatisfied(
  organizationId: string,
  claimId: string,
): Promise<void> {
  const settlements = await db.settlement.findMany({
    where: { organizationId, claimId },
    include: { payments: true },
  });

  for (const settlement of settlements) {
    if (settlement.status !== SettlementStatus.ACCEPTED) {
      throw new DomainError(
        `Settlement ${settlement.id} is still ${settlement.status} — JBM must accept the insurer's settlement offer before closing the claim.`,
        409,
      );
    }
    const paidCents = settlement.payments.reduce(
      (sum, payment) => sum + toCents(payment.amount),
      0,
    );
    if (paidCents !== toCents(settlement.settlementAmount)) {
      throw new DomainError(
        `Settlement ${settlement.id}'s payments don't yet sum to its settlement amount — cannot close the claim.`,
        409,
      );
    }
    const allReconciled = settlement.payments.every((p) => p.reconciled);
    if (!allReconciled) {
      throw new DomainError(
        `Settlement ${settlement.id} has unreconciled payments — cannot close the claim.`,
        409,
      );
    }
  }
}
