import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/domain-error";
import { SettlementStatus } from "@/lib/generated/prisma/enums";

// M14: settlement recording + BR-09's closure gate. A claim can have
// multiple settlements (interim + final) — see docs/schema/M2B.md — so
// the gate checks every non-REJECTED settlement, not just the most
// recent one; a REJECTED settlement was never going to be paid and is
// excluded entirely. See docs/PAYMENTS.md.

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

async function transitionSettlementStatus(
  session: AuthSession,
  id: string,
  to: SettlementStatus,
) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);

  const before = await scoped.settlement.findUniqueOrThrow({ where: { id } });
  if (before.status !== SettlementStatus.PENDING) {
    throw new DomainError(
      `Cannot decide a settlement that is already ${before.status}.`,
      409,
    );
  }

  const settlement = await scoped.settlement.update({
    where: { id },
    data: { status: to, approvedById: session.user.id, approvedAt: new Date() },
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

export async function approveSettlement(session: AuthSession, id: string) {
  return transitionSettlementStatus(session, id, SettlementStatus.APPROVED);
}

export async function rejectSettlement(session: AuthSession, id: string) {
  return transitionSettlementStatus(session, id, SettlementStatus.REJECTED);
}

export async function getSettlement(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  return scoped.settlement.findUnique({
    where: { id },
    include: { payments: true },
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
 * BR-09: throws unless every non-REJECTED settlement on this claim is
 * APPROVED, its payments sum to the settlement amount, and every
 * payment is reconciled. Called from lib/claims/claim.ts's
 * transitionClaimStatus() on the SETTLED -> CLOSED transition — this
 * function has no RBAC/session of its own since it's a pure gate check,
 * not an action; the caller already checked write access.
 */
export async function assertClaimSettlementSatisfied(
  organizationId: string,
  claimId: string,
): Promise<void> {
  const settlements = await db.settlement.findMany({
    where: {
      organizationId,
      claimId,
      status: { not: SettlementStatus.REJECTED },
    },
    include: { payments: true },
  });

  for (const settlement of settlements) {
    if (settlement.status !== SettlementStatus.APPROVED) {
      throw new DomainError(
        `Settlement ${settlement.id} is still ${settlement.status} — approve or reject it before closing the claim.`,
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
