import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  createIncident,
  listIncidents,
  type ListIncidentsFilter,
} from "@/lib/incidents/incident";
import {
  IncidentSeverity,
  IncidentType,
} from "@/lib/generated/prisma/enums";

/** Shared by GET here and GET /api/incidents/export — parses the same filter shape from a URL's query string. */
export function parseListIncidentsFilter(
  searchParams: URLSearchParams,
): ListIncidentsFilter {
  const status = searchParams.get("status");
  const severity = searchParams.get("severity");
  const incidentType = searchParams.get("incidentType");
  const depotId = searchParams.get("depotId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  return {
    status: status === "OPEN" || status === "CLOSED" ? status : undefined,
    severity:
      severity && severity in IncidentSeverity
        ? (severity as IncidentSeverity)
        : undefined,
    incidentType:
      incidentType && incidentType in IncidentType
        ? (incidentType as IncidentType)
        : undefined,
    depotId: depotId ?? undefined,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
  };
}

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const incidents = await listIncidents(
      session,
      parseListIncidentsFilter(request.nextUrl.searchParams),
    );
    return NextResponse.json(incidents);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const incident = await createIncident(session, body);
    return NextResponse.json(incident, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
