import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { listWorkshops, createWorkshop } from "@/lib/masters/workshop";

export async function GET() {
  const session = await verifySession();
  try {
    const workshops = await listWorkshops(session);
    return NextResponse.json(workshops);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const workshop = await createWorkshop(session, body);
    return NextResponse.json(workshop, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
