import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getIncident } from "@/lib/incidents/incident";
import { listAuditLogForEntity } from "@/lib/audit";
import { listDocumentsForEntity } from "@/lib/documents/document";
import { listStageInstancesForCase } from "@/lib/tat/case-stage";
import { UploadEvidenceForm } from "@/components/incidents/upload-evidence-form";
import { DownloadEvidenceLink } from "@/components/incidents/download-evidence-link";
import { IncidentStatusActions } from "@/components/incidents/incident-status-actions";
import { UpdateIncidentDriverInfoForm } from "@/components/incidents/update-incident-driver-info-form";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { DownloadDocumentLink } from "@/components/documents/download-document-link";
import { StageInstancePanel } from "@/components/tat/stage-instance-panel";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { TimelineTab } from "@/components/shared/timeline-tab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "evidence", label: "Evidence" },
  { key: "telematics", label: "Telematics" },
  { key: "documents", label: "Documents" },
  { key: "assessment", label: "Assessment" },
  { key: "timeline", label: "Timeline" },
  { key: "tat", label: "TAT" },
];

// M21: Incident Detail becomes the design's 7-tab layout, replacing the
// M6 single flat page. See docs/INCIDENTS.md's M21 update.
export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;
  const { tab = "overview" } = await searchParams;

  const incident = await getIncident(session, id);
  if (!incident) notFound();

  const basePath = `/incidents/${incident.id}`;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href="/incidents"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Incidents
      </Link>

      <div className="mt-2 mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {incident.incidentNumber}
        </h1>
        <IncidentStatusActions
          incidentId={incident.id}
          status={incident.status}
        />
      </div>

      <DetailTabs basePath={basePath} activeTab={tab} tabs={TABS} />

      {tab === "overview" && (
        <div>
          <h2 className="mb-2 text-lg font-semibold tracking-tight">
            Incident
          </h2>
          <dl className="mb-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>{incident.status}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{incident.incidentType}</dd>
            <dt className="text-muted-foreground">Severity</dt>
            <dd>{incident.severity}</dd>
            <dt className="text-muted-foreground">When</dt>
            <dd>{new Date(incident.incidentDateTime).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd>{incident.locationAddress ?? "—"}</dd>
            <dt className="text-muted-foreground">Description</dt>
            <dd className="col-span-2">{incident.description}</dd>
          </dl>

          <h2 className="mb-2 text-lg font-semibold tracking-tight">
            Vehicle
          </h2>
          <dl className="mb-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Registration</dt>
            <dd>{incident.vehicle.registrationNumber}</dd>
            <dt className="text-muted-foreground">Chassis number</dt>
            <dd>{incident.vehicle.chassisNumber ?? "—"}</dd>
            <dt className="text-muted-foreground">Depot</dt>
            <dd>{incident.depot.name}</dd>
          </dl>

          <h2 className="mb-2 text-lg font-semibold tracking-tight">
            Driver
          </h2>
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Driver</dt>
            <dd>{incident.driver?.name ?? "—"}</dd>
            <dt className="text-muted-foreground">Injuries</dt>
            <dd>{incident.injuries ?? "—"}</dd>
            <dt className="text-muted-foreground">Third party involved</dt>
            <dd>
              {incident.thirdPartyInvolved === null
                ? "—"
                : incident.thirdPartyInvolved
                  ? "Yes"
                  : "No"}
            </dd>
          </dl>
          <UpdateIncidentDriverInfoForm
            incidentId={incident.id}
            injuries={incident.injuries}
            thirdPartyInvolved={incident.thirdPartyInvolved}
          />

          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                Claims
              </h2>
              <Link
                href={`/claims/new?incidentId=${incident.id}`}
                className="text-primary text-sm underline underline-offset-4"
              >
                File a claim
              </Link>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="py-2">Number</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {incident.claims.map((claim) => (
                  <tr key={claim.id} className="border-border border-b">
                    <td className="py-2">
                      <Link
                        href={`/claims/${claim.id}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {claim.claimNumber}
                      </Link>
                    </td>
                    <td className="py-2">{claim.claimType}</td>
                    <td className="py-2">{claim.status}</td>
                  </tr>
                ))}
                {incident.claims.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="text-muted-foreground py-4 text-center"
                    >
                      No claims filed yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "evidence" && (
        <div>
          <table className="mb-6 w-full text-left text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className="py-2">Type</th>
                <th className="py-2">File</th>
                <th className="py-2">Caption</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {incident.evidence.map((item) => (
                <tr key={item.id} className="border-border border-b">
                  <td className="py-2">{item.evidenceType}</td>
                  <td className="py-2">{item.fileName}</td>
                  <td className="py-2">{item.caption ?? "—"}</td>
                  <td className="py-2">
                    <DownloadEvidenceLink
                      incidentId={incident.id}
                      evidenceId={item.id}
                    />
                  </td>
                </tr>
              ))}
              {incident.evidence.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="text-muted-foreground py-4 text-center"
                  >
                    No evidence yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <UploadEvidenceForm incidentId={incident.id} />
        </div>
      )}

      {tab === "telematics" && (
        <p className="text-muted-foreground text-sm">
          No telematics data captured — BR-06&apos;s incident-time snapshot
          capture is deferred to M12 (pending JBM FMS API access). This
          tab is a placeholder until then.
        </p>
      )}

      {tab === "documents" && (
        <IncidentDocumentsTab session={session} incidentId={incident.id} />
      )}

      {tab === "assessment" && (
        <div className="max-w-xl">
          <h2 className="mb-2 text-lg font-semibold tracking-tight">
            Preliminary assessment
          </h2>
          <p className="mb-4 text-sm">{incident.description}</p>
          <Link
            href={`/claims/new?incidentId=${incident.id}`}
            className="border-input inline-block rounded-md border px-3 py-2 text-sm"
          >
            Convert to claim
          </Link>
        </div>
      )}

      {tab === "timeline" && (
        <TimelineTab
          entries={await listAuditLogForEntity(
            session.user.organizationId,
            "Incident",
            incident.id,
          )}
        />
      )}

      {tab === "tat" && (
        <TatTab session={session} incidentId={incident.id} />
      )}
    </div>
  );
}

async function IncidentDocumentsTab({
  session,
  incidentId,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  incidentId: string;
}) {
  const documents = await listDocumentsForEntity(session, {
    linkedEntityType: "INCIDENT",
    linkedEntityId: incidentId,
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
            No documents linked to this incident yet.
          </li>
        )}
      </ul>
      <UploadDocumentForm
        linkedEntityType="INCIDENT"
        linkedEntityId={incidentId}
      />
    </div>
  );
}

async function TatTab({
  session,
  incidentId,
}: {
  session: Awaited<ReturnType<typeof verifySession>>;
  incidentId: string;
}) {
  const stages = await listStageInstancesForCase(session, { incidentId });
  return <StageInstancePanel instances={stages} />;
}
