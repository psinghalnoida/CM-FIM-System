import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import {
  getVehicle,
  getVehicleHistory,
} from "@/lib/masters/vehicle";
import { listWarrantiesForVehicle } from "@/lib/masters/warranty";
import { listDocumentsForEntity } from "@/lib/documents/document";
import { listAuditLogForEntity } from "@/lib/audit";
import { getDepot } from "@/lib/masters/depot";
import { DetailTabs } from "@/components/shared/detail-tabs";
import { UploadDocumentForm } from "@/components/documents/upload-document-form";
import { DownloadDocumentLink } from "@/components/documents/download-document-link";
import { CreateWarrantyForm } from "@/components/masters/create-warranty-form";
import { UpdateVehicleStatusForm } from "@/components/masters/update-vehicle-status-form";

const TABS = [
  { key: "information", label: "Information" },
  { key: "status", label: "Status" },
  { key: "documents", label: "Documents" },
  { key: "incidents", label: "Incidents" },
  { key: "claims", label: "Claims" },
  { key: "repairs", label: "Repair History" },
  { key: "warranty", label: "Warranty" },
  { key: "telematics", label: "Telematics" },
];

// M28: the design's 8-tab Vehicle Detail profile. No original design
// file was available to build against directly (it lived outside this
// repo — see docs/SCOPE.md's UI/UX alignment note) beyond SCOPE.md's
// one-line summary naming 5 of the 8 tabs; the tab structure here
// (Information/Status/Documents/Incidents/Claims/Repair History/
// Warranty/Telematics) is this app's own reasonable interpretation,
// confirmed with the user before building — mirroring the same `?tab=`
// pattern and tab count as Incident Detail's own 7 tabs (M21). See
// docs/MASTERS.md's M28 section.
export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;
  const { tab = "information" } = await searchParams;

  const vehicle = await getVehicle(session, id);
  if (!vehicle) notFound();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href="/vehicles"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Vehicles
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">
        {vehicle.registrationNumber}
      </h1>

      <DetailTabs basePath={`/vehicles/${id}`} activeTab={tab} tabs={TABS} />

      {tab === "information" && (
        <InformationTab session={session} vehicle={vehicle} />
      )}
      {tab === "status" && <StatusTab session={session} vehicle={vehicle} />}
      {tab === "documents" && <DocumentsTab session={session} vehicleId={id} />}
      {tab === "incidents" && (
        <IncidentsTab session={session} vehicleId={id} />
      )}
      {tab === "claims" && <ClaimsTab session={session} vehicleId={id} />}
      {tab === "repairs" && <RepairsTab session={session} vehicleId={id} />}
      {tab === "warranty" && (
        <WarrantyTab session={session} vehicleId={id} />
      )}
      {tab === "telematics" && <TelematicsTab />}
    </div>
  );
}

type Session = Awaited<ReturnType<typeof verifySession>>;
type Vehicle = NonNullable<Awaited<ReturnType<typeof getVehicle>>>;

async function InformationTab({
  session,
  vehicle,
}: {
  session: Session;
  vehicle: Vehicle;
}) {
  const depot = await getDepot(session, vehicle.depotId);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Registration</dt>
      <dd>{vehicle.registrationNumber}</dd>
      <dt className="text-muted-foreground">Type</dt>
      <dd>{vehicle.vehicleType}</dd>
      <dt className="text-muted-foreground">Make / Model</dt>
      <dd>
        {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—"}
      </dd>
      <dt className="text-muted-foreground">Chassis number</dt>
      <dd>{vehicle.chassisNumber ?? "—"}</dd>
      <dt className="text-muted-foreground">Engine number</dt>
      <dd>{vehicle.engineNumber ?? "—"}</dd>
      <dt className="text-muted-foreground">Manufacture year</dt>
      <dd>{vehicle.manufactureYear ?? "—"}</dd>
      <dt className="text-muted-foreground">Registration date</dt>
      <dd>
        {vehicle.registrationDate
          ? new Date(vehicle.registrationDate).toLocaleDateString()
          : "—"}
      </dd>
      <dt className="text-muted-foreground">Depot</dt>
      <dd>{depot?.name ?? "—"}</dd>
    </dl>
  );
}

async function StatusTab({
  session,
  vehicle,
}: {
  session: Session;
  vehicle: Vehicle;
}) {
  const auditLog = await listAuditLogForEntity(
    session.user.organizationId,
    "Vehicle",
    vehicle.id,
  );
  const statusChanges = auditLog.filter((e) => e.action === "STATUS_CHANGE");

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <span className="text-lg font-semibold">{vehicle.status}</span>
        <UpdateVehicleStatusForm vehicleId={vehicle.id} status={vehicle.status} />
      </div>

      <h2 className="mb-2 text-lg font-semibold tracking-tight">
        Status history
      </h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Date</th>
            <th className="py-2">Change</th>
          </tr>
        </thead>
        <tbody>
          {statusChanges.map((entry) => (
            <tr key={entry.id} className="border-border border-b">
              <td className="text-muted-foreground py-2">
                {new Date(entry.createdAt).toLocaleString()}
              </td>
              <td className="py-2">
                {JSON.stringify(entry.beforeData)} →{" "}
                {JSON.stringify(entry.afterData)}
              </td>
            </tr>
          ))}
          {statusChanges.length === 0 && (
            <tr>
              <td
                colSpan={2}
                className="text-muted-foreground py-4 text-center"
              >
                No status changes yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

async function DocumentsTab({
  session,
  vehicleId,
}: {
  session: Session;
  vehicleId: string;
}) {
  const documents = await listDocumentsForEntity(session, {
    linkedEntityType: "VEHICLE",
    linkedEntityId: vehicleId,
  });

  return (
    <div>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Title</th>
            <th className="py-2">Type</th>
            <th className="py-2">Version</th>
            <th className="py-2">File</th>
            <th className="py-2"></th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-border border-b">
              <td className="py-2">{doc.title}</td>
              <td className="py-2">{doc.documentType}</td>
              <td className="py-2">
                v{doc.currentVersion?.versionNumber ?? "—"}
              </td>
              <td className="py-2">{doc.currentVersion?.fileName ?? "—"}</td>
              <td className="py-2">
                <DownloadDocumentLink documentId={doc.id} />
              </td>
              <td className="py-2">
                <Link
                  href={`/documents/${doc.id}/ocr`}
                  className="text-primary underline underline-offset-4"
                >
                  OCR
                </Link>
              </td>
            </tr>
          ))}
          {documents.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="text-muted-foreground py-4 text-center"
              >
                No documents yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <UploadDocumentForm
        linkedEntityType="VEHICLE"
        linkedEntityId={vehicleId}
      />
    </div>
  );
}

async function IncidentsTab({
  session,
  vehicleId,
}: {
  session: Session;
  vehicleId: string;
}) {
  const { incidents } = await getVehicleHistory(session, vehicleId);
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-border border-b">
          <th className="py-2">Number</th>
          <th className="py-2">Type</th>
          <th className="py-2">Status</th>
          <th className="py-2">Date</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((incident) => (
          <tr key={incident.id} className="border-border border-b">
            <td className="py-2 font-medium">
              <Link
                href={`/incidents/${incident.id}`}
                className="text-primary underline underline-offset-4"
              >
                {incident.incidentNumber}
              </Link>
            </td>
            <td className="py-2">{incident.incidentType}</td>
            <td className="py-2">{incident.status}</td>
            <td className="text-muted-foreground py-2">
              {new Date(incident.incidentDateTime).toLocaleDateString()}
            </td>
          </tr>
        ))}
        {incidents.length === 0 && (
          <tr>
            <td colSpan={4} className="text-muted-foreground py-4 text-center">
              No incidents for this vehicle.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

async function ClaimsTab({
  session,
  vehicleId,
}: {
  session: Session;
  vehicleId: string;
}) {
  const { claims } = await getVehicleHistory(session, vehicleId);
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-border border-b">
          <th className="py-2">Number</th>
          <th className="py-2">Type</th>
          <th className="py-2">Status</th>
          <th className="py-2">Incident</th>
        </tr>
      </thead>
      <tbody>
        {claims.map((claim) => (
          <tr key={claim.id} className="border-border border-b">
            <td className="py-2 font-medium">
              <Link
                href={`/claims/${claim.id}`}
                className="text-primary underline underline-offset-4"
              >
                {claim.claimNumber}
              </Link>
            </td>
            <td className="py-2">{claim.claimType}</td>
            <td className="py-2">{claim.status}</td>
            <td className="text-muted-foreground py-2">
              {claim.incident.incidentNumber}
            </td>
          </tr>
        ))}
        {claims.length === 0 && (
          <tr>
            <td colSpan={4} className="text-muted-foreground py-4 text-center">
              No claims for this vehicle.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

async function RepairsTab({
  session,
  vehicleId,
}: {
  session: Session;
  vehicleId: string;
}) {
  const { repairJobs } = await getVehicleHistory(session, vehicleId);
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-border border-b">
          <th className="py-2">Workshop</th>
          <th className="py-2">Status</th>
          <th className="py-2">Est. cost</th>
          <th className="py-2">Claim</th>
        </tr>
      </thead>
      <tbody>
        {repairJobs.map((job) => (
          <tr key={job.id} className="border-border border-b">
            <td className="py-2">
              <Link
                href={`/claims/${job.claimId}/repair-jobs/${job.id}`}
                className="text-primary underline underline-offset-4"
              >
                {job.workshop.name}
              </Link>
            </td>
            <td className="py-2">{job.status}</td>
            <td className="py-2">
              {job.estimatedCost
                ? `${job.currency} ${job.estimatedCost.toString()}`
                : "—"}
            </td>
            <td className="text-muted-foreground py-2">
              {job.claim.claimNumber}
            </td>
          </tr>
        ))}
        {repairJobs.length === 0 && (
          <tr>
            <td colSpan={4} className="text-muted-foreground py-4 text-center">
              No repair jobs for this vehicle.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

async function WarrantyTab({
  session,
  vehicleId,
}: {
  session: Session;
  vehicleId: string;
}) {
  const warranties = await listWarrantiesForVehicle(session, vehicleId);
  return (
    <div>
      <table className="mb-6 w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Provider</th>
            <th className="py-2">Coverage</th>
            <th className="py-2">Start</th>
            <th className="py-2">End</th>
          </tr>
        </thead>
        <tbody>
          {warranties.map((w) => (
            <tr key={w.id} className="border-border border-b">
              <td className="py-2">{w.provider}</td>
              <td className="text-muted-foreground py-2">
                {w.coverageDescription ?? "—"}
              </td>
              <td className="text-muted-foreground py-2">
                {new Date(w.startDate).toLocaleDateString()}
              </td>
              <td className="text-muted-foreground py-2">
                {new Date(w.endDate).toLocaleDateString()}
              </td>
            </tr>
          ))}
          {warranties.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="text-muted-foreground py-4 text-center"
              >
                No warranties on record.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <CreateWarrantyForm vehicleId={vehicleId} />
    </div>
  );
}

// M28: same honest-placeholder treatment as Incident Detail's Telematics
// tab (M21) — TelematicsSnapshot has existed in the schema since M2a but
// nothing writes to it yet; that's M12, gated on JBM FMS API access.
function TelematicsTab() {
  return (
    <p className="text-muted-foreground text-sm">
      Telematics data isn&apos;t available yet — this requires the JBM FMS
      API integration (BR-06, see docs/SCOPE.md&apos;s M12).
    </p>
  );
}
