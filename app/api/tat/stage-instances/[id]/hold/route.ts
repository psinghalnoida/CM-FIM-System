import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { startHold } from "@/lib/tat/case-stage";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const hold = await startHold(session, id, body);
    return NextResponse.json(hold, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
