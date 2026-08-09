import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getRepairJob, updateRepairJob } from "@/lib/claims/repair-job";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; repairJobId: string }> },
) {
  const session = await verifySession();
  const { repairJobId } = await params;
  try {
    const repairJob = await getRepairJob(session, repairJobId);
    if (!repairJob)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(repairJob);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; repairJobId: string }> },
) {
  const session = await verifySession();
  const { repairJobId } = await params;
  try {
    const body = await request.json();
    const repairJob = await updateRepairJob(session, repairJobId, body);
    return NextResponse.json(repairJob);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
