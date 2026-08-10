import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/domain-error";
import { SettlementStatus, PaymentMethod } from "@/lib/generated/prisma/enums";

// M14: payments recorded against an ACCEPTED settlement (M19: renamed
// from APPROVED — JBM accepting the insurer's offer, not approving a
// claim), then reconciled — both are inputs to BR-09's closure gate
// (lib/settlements/settlement.ts). See docs/PAYMENTS.md.

const WRITE_ROLES = ["ORG_ADMIN", "FINANCE_OFFICER"] as const;

// Payment has no organizationId column (schema.prisma) — access is
// resolved through Settlement (which IS org-scoped), the same pattern
// established for Evidence (M6) and WorkshopActivity (M7).
async function assertSettlementAccessible(
  session: AuthSession,
  settlementId: string,
) {
  const scoped = scopedDb(session.user.organizationId);
  return scoped.settlement.findUniqueOrThrow({ where: { id: settlementId } });
}

export const CreatePaymentSchema = z.object({
  settlementId: z.uuid(),
  amount: z.number().positive(),
  currency: z.string().trim().length(3).optional(),
  paymentDate: z.coerce.date(),
  paymentReference: z.string().trim().max(200).optional(),
  paymentMethod: z.enum(PaymentMethod).optional(),
});
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

export async function createPayment(session: AuthSession, input: unknown) {
  requireRole(session, ...WRITE_ROLES);
  const data = CreatePaymentSchema.parse(input);
  const settlement = await assertSettlementAccessible(
    session,
    data.settlementId,
  );

  if (settlement.status !== SettlementStatus.ACCEPTED) {
    throw new DomainError(
      `Cannot record a payment against a settlement that is ${settlement.status}, not ACCEPTED.`,
      409,
    );
  }

  const scoped = scopedDb(session.user.organizationId);
  const payment = await scoped.payment.create({
    data: {
      settlementId: data.settlementId,
      amount: data.amount,
      currency: data.currency ?? settlement.currency,
      paymentDate: data.paymentDate,
      paymentReference: data.paymentReference,
      paymentMethod: data.paymentMethod ?? PaymentMethod.BANK_TRANSFER,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Payment",
    entityId: payment.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: payment,
    sourceChannel: "WEB",
  });

  return payment;
}

export async function reconcilePayment(session: AuthSession, id: string) {
  requireRole(session, ...WRITE_ROLES);

  // Payment has no organizationId column, so scopedDb() would NOT filter
  // it (it's not in ORG_SCOPED_MODELS) — querying it directly by id would
  // let a user reconcile another org's payment. Resolve org access
  // through the parent Settlement first, via the plain db client, the
  // same fix shape as M6's getEvidenceDownloadUrl().
  const before = await db.payment.findUniqueOrThrow({
    where: { id },
    include: { settlement: true },
  });
  if (before.settlement.organizationId !== session.user.organizationId) {
    // Deliberately a 404, not forbidden() — don't confirm cross-org existence.
    throw new DomainError("Payment not found.", 404);
  }
  if (before.reconciled) {
    throw new DomainError("Payment is already reconciled.", 409);
  }

  const payment = await db.payment.update({
    where: { id },
    data: {
      reconciled: true,
      reconciledById: session.user.id,
      reconciledAt: new Date(),
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Payment",
    entityId: payment.id,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: { reconciled: false },
    afterData: { reconciled: true },
    sourceChannel: "WEB",
  });

  return payment;
}

export async function listPaymentsForSettlement(
  session: AuthSession,
  settlementId: string,
) {
  await assertSettlementAccessible(session, settlementId);
  const scoped = scopedDb(session.user.organizationId);
  return scoped.payment.findMany({
    where: { settlementId },
    orderBy: { paymentDate: "asc" },
  });
}

/** M19: backs the standalone Payment Detail page. Same cross-org fix as reconcilePayment — resolved through Settlement, not queried by id directly. */
export async function getPayment(session: AuthSession, id: string) {
  const payment = await db.payment.findUnique({
    where: { id },
    include: { settlement: { include: { claim: true } } },
  });
  if (!payment) return null;
  if (payment.settlement.organizationId !== session.user.organizationId) {
    return null;
  }
  return payment;
}
