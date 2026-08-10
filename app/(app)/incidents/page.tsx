import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { listIncidents } from "@/lib/incidents/incident";
import { listDepots } from "@/lib/masters/depot";
import {
  IncidentSeverity,
  IncidentType,
} from "@/lib/generated/prisma/enums";

const SEVERITIES = Object.values(IncidentSeverity);
const TYPES = Object.values(IncidentType);

// M21: richer filters + Export, replacing the M6 demo page's flat list.
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    severity?: string;
    incidentType?: string;
    depotId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const session = await verifySession();
  const params = await searchParams;

  const status =
    params.status === "OPEN" || params.status === "CLOSED"
      ? params.status
      : undefined;
  const severity =
    params.severity && (SEVERITIES as string[]).includes(params.severity)
      ? (params.severity as IncidentSeverity)
      : undefined;
  const incidentType =
    params.incidentType && (TYPES as string[]).includes(params.incidentType)
      ? (params.incidentType as IncidentType)
      : undefined;

  const [incidents, depots] = await Promise.all([
    listIncidents(session, {
      status,
      severity,
      incidentType,
      depotId: params.depotId || undefined,
      dateFrom: params.dateFrom ? new Date(params.dateFrom) : undefined,
      dateTo: params.dateTo ? new Date(params.dateTo) : undefined,
    }),
    listDepots(session),
  ]);

  const exportQuery = new URLSearchParams();
  if (status) exportQuery.set("status", status);
  if (severity) exportQuery.set("severity", severity);
  if (incidentType) exportQuery.set("incidentType", incidentType);
  if (params.depotId) exportQuery.set("depotId", params.depotId);
  if (params.dateFrom) exportQuery.set("dateFrom", params.dateFrom);
  if (params.dateTo) exportQuery.set("dateTo", params.dateTo);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
        <div className="flex items-center gap-4">
          <a
            href={`/api/incidents/export?${exportQuery.toString()}`}
            className="text-primary text-sm underline underline-offset-4"
          >
            Export
          </a>
          <Link
            href="/incidents/new"
            className="text-primary text-sm underline underline-offset-4"
          >
            Report incident
          </Link>
        </div>
      </div>

      <form
        method="get"
        className="mb-6 flex flex-wrap items-end gap-3 text-sm"
      >
        <div className="space-y-1">
          <label htmlFor="status" className="text-muted-foreground block">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="severity" className="text-muted-foreground block">
            Severity
          </label>
          <select
            id="severity"
            name="severity"
            defaultValue={severity ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="incidentType" className="text-muted-foreground block">
            Type
          </label>
          <select
            id="incidentType"
            name="incidentType"
            defaultValue={incidentType ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          >
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        {depots.length > 1 && (
          <div className="space-y-1">
            <label htmlFor="depotId" className="text-muted-foreground block">
              Depot
            </label>
            <select
              id="depotId"
              name="depotId"
              defaultValue={params.depotId ?? ""}
              className="border-input h-9 rounded-md border bg-transparent px-2"
            >
              <option value="">All depots</option>
              {depots.map((depot) => (
                <option key={depot.id} value={depot.id}>
                  {depot.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="dateFrom" className="text-muted-foreground block">
            From
          </label>
          <input
            id="dateFrom"
            name="dateFrom"
            type="date"
            defaultValue={params.dateFrom ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="dateTo" className="text-muted-foreground block">
            To
          </label>
          <input
            id="dateTo"
            name="dateTo"
            type="date"
            defaultValue={params.dateTo ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2"
          />
        </div>
        <button
          type="submit"
          className="border-input h-9 rounded-md border px-3"
        >
          Apply
        </button>
      </form>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="py-2">Number</th>
            <th className="py-2">Vehicle</th>
            <th className="py-2">Type</th>
            <th className="py-2">Severity</th>
            <th className="py-2">Status</th>
            <th className="py-2">Date</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id} className="border-border border-b">
              <td className="py-2">
                <Link
                  href={`/incidents/${incident.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  {incident.incidentNumber}
                </Link>
              </td>
              <td className="py-2">{incident.vehicle.registrationNumber}</td>
              <td className="py-2">{incident.incidentType}</td>
              <td className="py-2">{incident.severity}</td>
              <td className="py-2">{incident.status}</td>
              <td className="py-2">
                {new Date(incident.incidentDateTime).toLocaleDateString()}
              </td>
            </tr>
          ))}
          {incidents.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="text-muted-foreground py-4 text-center"
              >
                No incidents match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
