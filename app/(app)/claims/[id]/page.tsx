import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getClaim, CLAIM_TRANSITIONS } from "@/lib/claims/claim";
import { listClaimCommunications } from "@/lib/claims/communication";
import { listAuditLogForEntity } from "@/lib/audit";
import { StatusTransitionSelect } from "@/components/claims/status-transition-select";
import { CreateSurveyForm } from "@/components/claims/create-survey-form";
import { CreateRepairJobForm } from "@/components/claims/create-repair-job-form";
import { CreateCommunicationForm } from "@/components/claims/create-communication-form";
import { listStageInstancesForCase } from "@/lib/tat/case-stage";
import { StageInstancePanel } from "@/components/tat/stage-instance-panel";
import { listSettlementsForClaim } from "@/lib/settlements/settlement";
import { CreateSettlementForm } from "@/components/settlements/create-settlement-form";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { TimelineTab } from "@/components/shared/timeline-tab";
import { listSurveyors } from "@/lib/masters/surveyor";
import { listWorkshops } from "@/lib/masters/workshop";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "communication", label: "Communication" },
  { key: "audit", label: "Audit" },
];

// M20: Claim Detail becomes tabbed — Overview holds everything this page
// already had (surveys/repair jobs/TAT/settlements), Communication and
// Audit are new. See docs/CLAIMS.md's M20 update.
export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;

  const claim = await getClaim(session, id);
  if (!claim) notFound();

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

      <DetailTabs basePath={`/claims/${claim.id}`} activeTab={tab} tabs={TABS} />

      {tab === "overview" && (
        <OverviewTab session={session} claim={claim} />
      )}

      {tab === "communication" && (
        <CommunicationTab session={session} claimId={claim.id} />
      )}

      {tab === "audit" && (
        <TimelineTab
          entries={await listAuditLogForEntity(
            session.user.organizationId,
            "Claim",
            claim.id,
          )}
        />
      )}
    </div>
  );
}

async function OverviewTab({
  session,
  claim,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  claim: NonNullable<Awaited<ReturnType<typeof getClaim>>>;
}) {
  const stages = await listStageInstancesForCase(session, {
    claimId: claim.id,
  });
  const settlements = await listSettlementsForClaim(session, claim.id);
  const [surveyors, workshops] = await Promise.all([
    listSurveyors(session),
    listWorkshops(session),
  ]);

  return (
    <div>
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
            ? `${claim.policy.policyNumber} (${claim.policy.insurer.name})`
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
              <td className="py-2">{survey.surveyor.name}</td>
              <td className="py-2">{survey.status}</td>
              <td className="py-2">
                <Link
                  href={`/claims/${claim.id}/surveys/${survey.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  View
                </Link>
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
      <CreateSurveyForm
        claimId={claim.id}
        surveyors={surveyors.map((s) => ({ id: s.id, name: s.name }))}
      />

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
              <td className="py-2">{repairJob.workshop.name}</td>
              <td className="py-2">
                {repairJob.estimatedCost
                  ? `${repairJob.currency} ${repairJob.estimatedCost}`
                  : "—"}
              </td>
              <td className="py-2">{repairJob.status}</td>
              <td className="py-2">
                <Link
                  href={`/claims/${claim.id}/repair-jobs/${repairJob.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  View
                </Link>
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
      <CreateRepairJobForm
        claimId={claim.id}
        workshops={workshops.map((w) => ({ id: w.id, name: w.name }))}
      />

      <h2 className="mt-8 mb-2 text-lg font-semibold tracking-tight">
        TAT stages
      </h2>
      <StageInstancePanel instances={stages} />

      <h2 className="mt-8 mb-2 text-lg font-semibold tracking-tight">
        Settlements
      </h2>
      <table className="mb-3 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Amount</th>
            <th className="py-2">JBM&apos;s response</th>
            <th className="py-2">Payments</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {settlements.map((settlement) => (
            <tr key={settlement.id} className="border-border border-b">
              <td className="py-2">
                {settlement.currency} {settlement.settlementAmount.toString()}
              </td>
              <td className="py-2">{settlement.status}</td>
              <td className="py-2">{settlement.payments.length}</td>
              <td className="py-2">
                <Link
                  href={`/claims/${claim.id}/settlements/${settlement.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
          {settlements.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="text-muted-foreground py-4 text-center"
              >
                No settlements recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateSettlementForm claimId={claim.id} />
    </div>
  );
}

async function CommunicationTab({
  session,
  claimId,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  claimId: string;
}) {
  const communications = await listClaimCommunications(session, claimId);

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3 text-sm">
        {communications.map((entry) => (
          <li
            key={entry.id}
            className="border-border grid grid-cols-[140px_1fr] gap-3 border-b pb-3"
          >
            <div className="text-muted-foreground pt-0.5 text-xs">
              {new Date(entry.occurredAt).toLocaleString()}
            </div>
            <div>
              <p>{entry.description}</p>
              {entry.actor && (
                <span className="text-muted-foreground text-xs">
                  — {entry.actor.name}
                </span>
              )}
            </div>
          </li>
        ))}
        {communications.length === 0 && (
          <li className="text-muted-foreground">
            No communication logged yet.
          </li>
        )}
      </ul>
      <CreateCommunicationForm claimId={claimId} />
    </div>
  );
}
