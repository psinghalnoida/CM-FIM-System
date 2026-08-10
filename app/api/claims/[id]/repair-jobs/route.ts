import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  createRepairJob,
  listRepairJobsForClaim,
} from "@/lib/claims/repair-job";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const repairJobs = await listRepairJobsForClaim(session, id);
    return NextResponse.json(repairJobs);
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
    const repairJob = await createRepairJob(session, { ...body, claimId: id });
    return NextResponse.json(repairJob, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
