import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createIncident, listIncidents } from "@/lib/incidents/incident";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const status = request.nextUrl.searchParams.get("status");
    const incidents = await listIncidents(
      session,
      status === "OPEN" || status === "CLOSED" ? { status } : {},
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
