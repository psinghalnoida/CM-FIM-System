import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getDepot, updateDepot } from "@/lib/masters/depot";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  const depot = await getDepot(session, id);
  if (!depot)
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(depot);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const depot = await updateDepot(session, id, body);
    return NextResponse.json(depot);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
