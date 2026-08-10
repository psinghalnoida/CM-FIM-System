import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  archiveVehicle,
  getVehicle,
  updateVehicle,
} from "@/lib/masters/vehicle";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  const vehicle = await getVehicle(session, id);
  if (!vehicle)
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(vehicle);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const vehicle = await updateVehicle(session, id, body);
    return NextResponse.json(vehicle);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

/** Archives (soft-deletes) the vehicle — sets status to INACTIVE, never a hard delete. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const vehicle = await archiveVehicle(session, id);
    return NextResponse.json(vehicle);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
