import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getIncident, updateIncident } from "@/lib/incidents/incident";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const incident = await getIncident(session, id);
    if (!incident)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(incident);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const incident = await updateIncident(session, id, body);
    return NextResponse.json(incident);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
