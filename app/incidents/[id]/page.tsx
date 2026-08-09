import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getIncident } from "@/lib/incidents/incident";
import { UploadEvidenceForm } from "@/components/incidents/upload-evidence-form";
import { DownloadEvidenceLink } from "@/components/incidents/download-evidence-link";
import { IncidentStatusActions } from "@/components/incidents/incident-status-actions";

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;

  const incident = await getIncident(session, id);
  if (!incident) notFound();

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

      <dl className="mb-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{incident.status}</dd>
        <dt className="text-muted-foreground">Vehicle</dt>
        <dd>{incident.vehicle.registrationNumber}</dd>
        <dt className="text-muted-foreground">Driver</dt>
        <dd>{incident.driver?.name ?? "—"}</dd>
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

      <h2 className="mb-2 text-lg font-semibold tracking-tight">Evidence</h2>
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
  );
}
