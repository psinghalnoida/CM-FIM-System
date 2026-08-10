import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { closeIncident } from "@/lib/incidents/incident";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const incident = await closeIncident(session, id);
    return NextResponse.json(incident);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
