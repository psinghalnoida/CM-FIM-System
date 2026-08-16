import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  listWarrantiesForVehicle,
  createWarranty,
} from "@/lib/masters/warranty";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const warranties = await listWarrantiesForVehicle(session, id);
    return NextResponse.json(warranties);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const warranty = await createWarranty(session, { ...body, vehicleId: id });
    return NextResponse.json(warranty, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
