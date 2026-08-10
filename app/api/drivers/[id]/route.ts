import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { archiveDriver, getDriver, updateDriver } from "@/lib/masters/driver";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  const driver = await getDriver(session, id);
  if (!driver)
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(driver);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const driver = await updateDriver(session, id, body);
    return NextResponse.json(driver);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

/** Archives (soft-deletes) the driver — sets status to INACTIVE, never a hard delete. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const driver = await archiveDriver(session, id);
    return NextResponse.json(driver);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
