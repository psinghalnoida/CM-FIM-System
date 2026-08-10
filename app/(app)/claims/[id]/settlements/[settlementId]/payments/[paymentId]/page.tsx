import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getPayment } from "@/lib/settlements/payment";
import { listAuditLogForEntity } from "@/lib/audit";
import { ReconcilePaymentButton } from "@/components/settlements/reconcile-payment-button";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { TimelineTab } from "@/components/shared/timeline-tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "timeline", label: "Timeline" },
];

// M19: standalone Payment Detail page, replacing the inline row on the
// (now also standalone) Settlement Detail page.
export default async function PaymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; settlementId: string; paymentId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { id: claimId, settlementId, paymentId } = await params;
  const { tab = "overview" } = await searchParams;

  const payment = await getPayment(session, paymentId);
  if (!payment) notFound();

  const basePath = `/claims/${claimId}/settlements/${settlementId}/payments/${paymentId}`;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href={`/claims/${claimId}/settlements/${settlementId}`}
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Settlement — {payment.settlement.claim.claimNumber}
      </Link>

      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">
        Payment — {payment.currency} {payment.amount.toString()}
      </h1>

      <DetailTabs basePath={basePath} activeTab={tab} tabs={TABS} />

      {tab === "overview" && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Amount</dt>
          <dd>
            {payment.currency} {payment.amount.toString()}
          </dd>
          <dt className="text-muted-foreground">Date</dt>
          <dd>{new Date(payment.paymentDate).toLocaleDateString()}</dd>
          <dt className="text-muted-foreground">Method</dt>
          <dd>{payment.paymentMethod}</dd>
          <dt className="text-muted-foreground">Reference</dt>
          <dd>{payment.paymentReference ?? "—"}</dd>
        </dl>
      )}

      {tab === "reconciliation" && (
        <div className="flex flex-col gap-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Reconciled</dt>
            <dd>{payment.reconciled ? "Yes" : "No"}</dd>
            <dt className="text-muted-foreground">Reconciled at</dt>
            <dd>
              {payment.reconciledAt
                ? new Date(payment.reconciledAt).toLocaleString()
                : "—"}
            </dd>
          </dl>
          {!payment.reconciled && (
            <ReconcilePaymentButton
              claimId={claimId}
              settlementId={settlementId}
              paymentId={paymentId}
            />
          )}
        </div>
      )}

      {tab === "timeline" && (
        <TimelineTab
          entries={await listAuditLogForEntity(
            session.user.organizationId,
            "Payment",
            paymentId,
          )}
        />
      )}
    </div>
  );
}
