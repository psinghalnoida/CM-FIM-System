import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getSettlement } from "@/lib/settlements/settlement";
import { listPaymentsForSettlement } from "@/lib/settlements/payment";
import { listAuditLogForEntity } from "@/lib/audit";
import { listDocumentsForEntity } from "@/lib/documents/document";
import { SettlementResponseActions } from "@/components/settlements/settlement-response-actions";
import { CreatePaymentForm } from "@/components/settlements/create-payment-form";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { DownloadDocumentLink } from "@/components/documents/download-document-link";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { TimelineTab } from "@/components/shared/timeline-tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "letter", label: "Settlement letter" },
  { key: "timeline", label: "Timeline" },
];

// M19: standalone Settlement Detail page, replacing the inline block on
// Claim Detail. Status here is JBM's *response* to the insurer's offer
// (ACCEPTED/DISPUTED/REVIEW_REQUESTED/PENDING), not an approval decision
// — see docs/PAYMENTS.md.
export default async function SettlementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; settlementId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { id: claimId, settlementId } = await params;
  const { tab = "overview" } = await searchParams;

  const settlement = await getSettlement(session, settlementId);
  if (!settlement) notFound();

  const basePath = `/claims/${claimId}/settlements/${settlementId}`;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href={`/claims/${claimId}`}
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Claim {settlement.claim.claimNumber}
      </Link>

      <div className="mt-2 mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Settlement — {settlement.currency} {settlement.settlementAmount.toString()}
        </h1>
        {settlement.status !== "ACCEPTED" && (
          <SettlementResponseActions
            claimId={claimId}
            settlementId={settlementId}
          />
        )}
      </div>

      <DetailTabs basePath={basePath} activeTab={tab} tabs={TABS} />

      {tab === "overview" && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">JBM&apos;s response</dt>
            <dd>{settlement.status}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd>
              {settlement.currency} {settlement.settlementAmount.toString()}
            </dd>
            <dt className="text-muted-foreground">Responded</dt>
            <dd>
              {settlement.respondedAt
                ? new Date(settlement.respondedAt).toLocaleString()
                : "—"}
            </dd>
          </dl>

          <div>
            <h2 className="mb-2 text-lg font-semibold tracking-tight">
              Payments
            </h2>
            <PaymentsSection
              session={session}
              claimId={claimId}
              settlementId={settlementId}
              accepted={settlement.status === "ACCEPTED"}
            />
          </div>
        </div>
      )}

      {tab === "letter" && (
        <SettlementLetterTab session={session} settlementId={settlementId} />
      )}

      {tab === "timeline" && (
        <TimelineTab
          entries={await listAuditLogForEntity(
            session.user.organizationId,
            "Settlement",
            settlementId,
          )}
        />
      )}
    </div>
  );
}

async function PaymentsSection({
  session,
  claimId,
  settlementId,
  accepted,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  claimId: string;
  settlementId: string;
  accepted: boolean;
}) {
  const payments = await listPaymentsForSettlement(session, settlementId);

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Amount</th>
            <th className="py-2">Date</th>
            <th className="py-2">Reconciled</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-border border-b">
              <td className="py-2">
                {payment.currency} {payment.amount.toString()}
              </td>
              <td className="py-2">
                {new Date(payment.paymentDate).toLocaleDateString()}
              </td>
              <td className="py-2">{payment.reconciled ? "Yes" : "No"}</td>
              <td className="py-2">
                <Link
                  href={`/claims/${claimId}/settlements/${settlementId}/payments/${payment.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted-foreground py-4 text-center">
                No payments recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {accepted && (
        <CreatePaymentForm claimId={claimId} settlementId={settlementId} />
      )}
    </div>
  );
}

async function SettlementLetterTab({
  session,
  settlementId,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  settlementId: string;
}) {
  const documents = await listDocumentsForEntity(session, {
    linkedEntityType: "SETTLEMENT",
    linkedEntityId: settlementId,
  });

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2 text-sm">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between">
            <span>
              {doc.title} (v{doc.currentVersion?.versionNumber ?? "—"})
            </span>
            <DownloadDocumentLink documentId={doc.id} />
          </li>
        ))}
        {documents.length === 0 && (
          <li className="text-muted-foreground">
            No settlement letter uploaded yet.
          </li>
        )}
      </ul>
      <UploadDocumentForm
        linkedEntityType="SETTLEMENT"
        linkedEntityId={settlementId}
      />
    </div>
  );
}
