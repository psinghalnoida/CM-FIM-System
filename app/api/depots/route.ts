import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createDepot, listDepots } from "@/lib/masters/depot";

export async function GET() {
  const session = await verifySession();
  const depots = await listDepots(session);
  return NextResponse.json(depots);
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const depot = await createDepot(session, body);
    return NextResponse.json(depot, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
