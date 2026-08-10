import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getSurvey, SURVEY_TRANSITIONS } from "@/lib/claims/survey";
import { listAuditLogForEntity } from "@/lib/audit";
import { listDocumentsForEntity } from "@/lib/documents/document";
import { StatusTransitionSelect } from "@/components/claims/status-transition-select";
import { UpdateSurveyFindingsForm } from "@/components/claims/update-survey-findings-form";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { DownloadDocumentLink } from "@/components/documents/download-document-link";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { TimelineTab } from "@/components/shared/timeline-tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "observations", label: "Observations" },
  { key: "report", label: "Report" },
  { key: "timeline", label: "Timeline" },
];

// M19: standalone Survey Detail page, replacing the inline row on Claim
// Detail — see docs/CLAIM_SUBRECORDS.md.
export default async function SurveyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; surveyId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { id: claimId, surveyId } = await params;
  const { tab = "overview" } = await searchParams;

  const survey = await getSurvey(session, surveyId);
  if (!survey) notFound();

  const basePath = `/claims/${claimId}/surveys/${surveyId}`;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href={`/claims/${claimId}`}
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Claim {survey.claim.claimNumber}
      </Link>

      <div className="mt-2 mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Survey {survey.surveyNumber}
        </h1>
        <StatusTransitionSelect
          endpoint={`/api/claims/${claimId}/surveys/${surveyId}/status`}
          options={SURVEY_TRANSITIONS[survey.status]}
        />
      </div>

      <DetailTabs basePath={basePath} activeTab={tab} tabs={TABS} />

      {tab === "overview" && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd>{survey.status}</dd>
          <dt className="text-muted-foreground">Surveyor</dt>
          <dd>{survey.surveyorName}</dd>
          <dt className="text-muted-foreground">Contact</dt>
          <dd>{survey.surveyorContact ?? "—"}</dd>
          <dt className="text-muted-foreground">Scheduled</dt>
          <dd>
            {survey.scheduledAt
              ? new Date(survey.scheduledAt).toLocaleString()
              : "—"}
          </dd>
          <dt className="text-muted-foreground">Conducted</dt>
          <dd>
            {survey.conductedAt
              ? new Date(survey.conductedAt).toLocaleString()
              : "—"}
          </dd>
        </dl>
      )}

      {tab === "observations" && (
        <UpdateSurveyFindingsForm
          claimId={claimId}
          surveyId={surveyId}
          findings={survey.findings}
        />
      )}

      {tab === "report" && (
        <SurveyReportTab session={session} surveyId={surveyId} />
      )}

      {tab === "timeline" && (
        <TimelineTab
          entries={await listAuditLogForEntity(
            session.user.organizationId,
            "Survey",
            surveyId,
          )}
        />
      )}
    </div>
  );
}

async function SurveyReportTab({
  session,
  surveyId,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  surveyId: string;
}) {
  const documents = await listDocumentsForEntity(session, {
    linkedEntityType: "SURVEY",
    linkedEntityId: surveyId,
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
            No survey report uploaded yet.
          </li>
        )}
      </ul>
      <UploadDocumentForm linkedEntityType="SURVEY" linkedEntityId={surveyId} />
    </div>
  );
}
