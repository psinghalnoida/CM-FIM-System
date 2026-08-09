import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { addWorkshopActivity } from "@/lib/claims/repair-job";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; repairJobId: string }> },
) {
  const session = await verifySession();
  const { repairJobId } = await params;
  try {
    const body = await request.json();
    const activity = await addWorkshopActivity(session, repairJobId, body);
    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
