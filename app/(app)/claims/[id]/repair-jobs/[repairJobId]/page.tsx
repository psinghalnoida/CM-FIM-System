import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getRepairJob, REPAIR_JOB_TRANSITIONS } from "@/lib/claims/repair-job";
import { listAuditLogForEntity } from "@/lib/audit";
import { listDocumentsForEntity } from "@/lib/documents/document";
import { StatusTransitionSelect } from "@/components/claims/status-transition-select";
import { CreateRepairPartForm } from "@/components/claims/create-repair-part-form";
import { CreateWorkshopActivityForm } from "@/components/claims/create-workshop-activity-form";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { DownloadDocumentLink } from "@/components/documents/download-document-link";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { TimelineTab } from "@/components/shared/timeline-tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "parts", label: "Parts" },
  { key: "progress", label: "Progress" },
  { key: "invoices", label: "Invoices" },
  { key: "timeline", label: "Timeline" },
];

// M19: standalone Repair Detail page, replacing the inline row on Claim
// Detail — see docs/CLAIM_SUBRECORDS.md.
export default async function RepairJobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; repairJobId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { id: claimId, repairJobId } = await params;
  const { tab = "overview" } = await searchParams;

  const repairJob = await getRepairJob(session, repairJobId);
  if (!repairJob) notFound();

  const basePath = `/claims/${claimId}/repair-jobs/${repairJobId}`;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href={`/claims/${claimId}`}
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Claim {repairJob.claim.claimNumber}
      </Link>

      <div className="mt-2 mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Repair job — {repairJob.workshop.name}
        </h1>
        <StatusTransitionSelect
          endpoint={`/api/claims/${claimId}/repair-jobs/${repairJobId}/status`}
          options={REPAIR_JOB_TRANSITIONS[repairJob.status]}
        />
      </div>

      <DetailTabs basePath={basePath} activeTab={tab} tabs={TABS} />

      {tab === "overview" && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd>{repairJob.status}</dd>
          <dt className="text-muted-foreground">Workshop</dt>
          <dd>{repairJob.workshop.name}</dd>
          <dt className="text-muted-foreground">Contact</dt>
          <dd>{repairJob.workshop.contact ?? "—"}</dd>
          <dt className="text-muted-foreground">Address</dt>
          <dd>{repairJob.workshop.address ?? "—"}</dd>
          <dt className="text-muted-foreground">Estimated cost</dt>
          <dd>
            {repairJob.estimatedCost
              ? `${repairJob.currency} ${repairJob.estimatedCost.toString()}`
              : "—"}
          </dd>
          <dt className="text-muted-foreground">Approved cost</dt>
          <dd>
            {repairJob.approvedCost
              ? `${repairJob.currency} ${repairJob.approvedCost.toString()}`
              : "—"}
          </dd>
          <dt className="text-muted-foreground">Start date</dt>
          <dd>
            {repairJob.startDate
              ? new Date(repairJob.startDate).toLocaleDateString()
              : "—"}
          </dd>
          <dt className="text-muted-foreground">End date</dt>
          <dd>
            {repairJob.endDate
              ? new Date(repairJob.endDate).toLocaleDateString()
              : "—"}
          </dd>
        </dl>
      )}

      {tab === "parts" && (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1 text-sm">
            {repairJob.parts.map((part) => (
              <li key={part.id}>{part.partName}</li>
            ))}
            {repairJob.parts.length === 0 && (
              <li className="text-muted-foreground">No parts recorded yet.</li>
            )}
          </ul>
          <CreateRepairPartForm claimId={claimId} repairJobId={repairJobId} />
        </div>
      )}

      {tab === "progress" && (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2 text-sm">
            {repairJob.activities.map((activity) => (
              <li key={activity.id} className="border-border border-b pb-2">
                <span className="font-medium">
                  {activity.activityType.replaceAll("_", " ")}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  — {new Date(activity.occurredAt).toLocaleString()}
                </span>
                {activity.notes && <p className="mt-1">{activity.notes}</p>}
              </li>
            ))}
            {repairJob.activities.length === 0 && (
              <li className="text-muted-foreground">
                No activity logged yet.
              </li>
            )}
          </ul>
          <CreateWorkshopActivityForm
            claimId={claimId}
            repairJobId={repairJobId}
          />
        </div>
      )}

      {tab === "invoices" && (
        <RepairInvoicesTab session={session} repairJobId={repairJobId} />
      )}

      {tab === "timeline" && (
        <TimelineTab
          entries={await listAuditLogForEntity(
            session.user.organizationId,
            "RepairJob",
            repairJobId,
          )}
        />
      )}
    </div>
  );
}

async function RepairInvoicesTab({
  session,
  repairJobId,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  repairJobId: string;
}) {
  const documents = await listDocumentsForEntity(session, {
    linkedEntityType: "REPAIR_JOB",
    linkedEntityId: repairJobId,
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
          <li className="text-muted-foreground">No invoices uploaded yet.</li>
        )}
      </ul>
      <UploadDocumentForm
        linkedEntityType="REPAIR_JOB"
        linkedEntityId={repairJobId}
      />
    </div>
  );
}
