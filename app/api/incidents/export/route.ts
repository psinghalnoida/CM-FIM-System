import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { listIncidents } from "@/lib/incidents/incident";
import { parseListIncidentsFilter } from "@/app/api/incidents/route";

// M21: the Incident List "Export" button. CSV rather than XLSX/PDF — the
// simplest format that opens directly in any spreadsheet tool, and the
// sensible default for an ops export button with no format specified.
const CSV_COLUMNS = [
  "Incident Number",
  "Vehicle",
  "Driver",
  "Type",
  "Severity",
  "Status",
  "Date/Time",
  "Depot",
  "Location",
  "Description",
] as const;

/** RFC 4180-ish: quote a field only when it needs it, doubling embedded quotes. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const incidents = await listIncidents(
      session,
      parseListIncidentsFilter(request.nextUrl.searchParams),
    );

    const rows = incidents.map((incident) =>
      [
        incident.incidentNumber,
        incident.vehicle.registrationNumber,
        incident.driver?.name ?? "",
        incident.incidentType,
        incident.severity,
        incident.status,
        new Date(incident.incidentDateTime).toISOString(),
        incident.depotId,
        incident.locationAddress ?? "",
        incident.description,
      ]
        .map((v) => csvField(String(v)))
        .join(","),
    );

    const csv = [CSV_COLUMNS.join(","), ...rows].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="incidents.csv"`,
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
