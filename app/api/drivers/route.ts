import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createDriver, listDrivers } from "@/lib/masters/driver";

export async function GET() {
  const session = await verifySession();
  const drivers = await listDrivers(session);
  return NextResponse.json(drivers);
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const driver = await createDriver(session, body);
    return NextResponse.json(driver, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
