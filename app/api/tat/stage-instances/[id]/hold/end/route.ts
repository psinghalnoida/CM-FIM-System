import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { endHold } from "@/lib/tat/case-stage";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const stage = await endHold(session, id);
    return NextResponse.json(stage);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
