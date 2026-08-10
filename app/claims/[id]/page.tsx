import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getClaim, CLAIM_TRANSITIONS } from "@/lib/claims/claim";
import { SURVEY_TRANSITIONS } from "@/lib/claims/survey";
import { REPAIR_JOB_TRANSITIONS } from "@/lib/claims/repair-job";
import { StatusTransitionSelect } from "@/components/claims/status-transition-select";
import { CreateSurveyForm } from "@/components/claims/create-survey-form";
import { CreateRepairJobForm } from "@/components/claims/create-repair-job-form";
import { listStageInstancesForCase } from "@/lib/tat/case-stage";
import { StageInstancePanel } from "@/components/tat/stage-instance-panel";
import { listSettlementsForClaim } from "@/lib/settlements/settlement";
import { CreateSettlementForm } from "@/components/settlements/create-settlement-form";
import { SettlementActions } from "@/components/settlements/settlement-actions";
import { CreatePaymentForm } from "@/components/settlements/create-payment-form";
import { ReconcilePaymentButton } from "@/components/settlements/reconcile-payment-button";

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;

  const claim = await getClaim(session, id);
  if (!claim) notFound();
  const stages = await listStageInstancesForCase(session, {
    claimId: claim.id,
  });
  const settlements = await listSettlementsForClaim(session, claim.id);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href="/claims"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Claims
      </Link>

      <div className="mt-2 mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {claim.claimNumber}
        </h1>
        <StatusTransitionSelect
          endpoint={`/api/claims/${claim.id}/status`}
          options={CLAIM_TRANSITIONS[claim.status]}
        />
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{claim.status}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>{claim.claimType}</dd>
        <dt className="text-muted-foreground">Incident</dt>
        <dd>
          <Link
            href={`/incidents/${claim.incident.id}`}
            className="text-primary underline underline-offset-4"
          >
            {claim.incident.incidentNumber}
          </Link>
        </dd>
        <dt className="text-muted-foreground">Policy</dt>
        <dd>
          {claim.policy
            ? `${claim.policy.policyNumber} (${claim.policy.insurerName})`
            : "No matching policy (BR-05)"}
        </dd>
      </dl>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">Surveys</h2>
      <table className="mb-3 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Number</th>
            <th className="py-2">Surveyor</th>
            <th className="py-2">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {claim.surveys.map((survey) => (
            <tr key={survey.id} className="border-border border-b">
              <td className="py-2">{survey.surveyNumber}</td>
              <td className="py-2">{survey.surveyorName}</td>
              <td className="py-2">{survey.status}</td>
              <td className="py-2">
                <StatusTransitionSelect
                  endpoint={`/api/claims/${claim.id}/surveys/${survey.id}/status`}
                  options={SURVEY_TRANSITIONS[survey.status]}
                />
              </td>
            </tr>
          ))}
          {claim.surveys.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="text-muted-foreground py-4 text-center"
              >
                No surveys yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateSurveyForm claimId={claim.id} />

      <h2 className="mt-8 mb-2 text-lg font-semibold tracking-tight">
        Repair jobs
      </h2>
      <table className="mb-3 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Workshop</th>
            <th className="py-2">Est. cost</th>
            <th className="py-2">Status</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {claim.repairJobs.map((repairJob) => (
            <tr key={repairJob.id} className="border-border border-b">
              <td className="py-2">{repairJob.workshopName}</td>
              <td className="py-2">
                {repairJob.estimatedCost
                  ? `${repairJob.currency} ${repairJob.estimatedCost}`
                  : "—"}
              </td>
              <td className="py-2">{repairJob.status}</td>
              <td className="py-2">
                <StatusTransitionSelect
                  endpoint={`/api/claims/${claim.id}/repair-jobs/${repairJob.id}/status`}
                  options={REPAIR_JOB_TRANSITIONS[repairJob.status]}
                />
              </td>
            </tr>
          ))}
          {claim.repairJobs.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="text-muted-foreground py-4 text-center"
              >
                No repair jobs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateRepairJobForm claimId={claim.id} />

      <h2 className="mt-8 mb-2 text-lg font-semibold tracking-tight">
        TAT stages
      </h2>
      <StageInstancePanel instances={stages} />

      <h2 className="mt-8 mb-2 text-lg font-semibold tracking-tight">
        Settlements
      </h2>
      <div className="mb-4 flex flex-col gap-4">
        {settlements.map((settlement) => (
          <div
            key={settlement.id}
            className="border-border rounded-md border p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm">
                {settlement.currency} {settlement.settlementAmount.toString()} —{" "}
                {settlement.status}
              </span>
              {settlement.status === "PENDING" && (
                <SettlementActions
                  claimId={claim.id}
                  settlementId={settlement.id}
                />
              )}
            </div>

            <table className="mb-2 w-full text-left text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="py-1">Amount</th>
                  <th className="py-1">Date</th>
                  <th className="py-1">Reference</th>
                  <th className="py-1">Reconciled</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {settlement.payments.map((payment) => (
                  <tr key={payment.id} className="border-border border-b">
                    <td className="py-1">
                      {payment.currency} {payment.amount.toString()}
                    </td>
                    <td className="py-1">
                      {new Date(payment.paymentDate).toLocaleDateString()}
                    </td>
                    <td className="py-1">{payment.paymentReference ?? "—"}</td>
                    <td className="py-1">
                      {payment.reconciled ? "Yes" : "No"}
                    </td>
                    <td className="py-1">
                      {!payment.reconciled && (
                        <ReconcilePaymentButton
                          claimId={claim.id}
                          settlementId={settlement.id}
                          paymentId={payment.id}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {settlement.payments.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="text-muted-foreground py-2 text-center"
                    >
                      No payments recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {settlement.status === "APPROVED" && (
              <CreatePaymentForm
                claimId={claim.id}
                settlementId={settlement.id}
              />
            )}
          </div>
        ))}
        {settlements.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No settlements recorded yet.
          </p>
        )}
      </div>
      <CreateSettlementForm claimId={claim.id} />
    </div>
  );
}
