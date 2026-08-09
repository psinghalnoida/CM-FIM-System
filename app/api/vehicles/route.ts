import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createVehicle, listVehicles } from "@/lib/masters/vehicle";

export async function GET() {
  const session = await verifySession();
  const vehicles = await listVehicles(session);
  return NextResponse.json(vehicles);
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const vehicle = await createVehicle(session, body);
    return NextResponse.json(vehicle, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
