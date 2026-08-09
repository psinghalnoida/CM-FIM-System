import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getStageInstance } from "@/lib/tat/case-stage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const instance = await getStageInstance(session, id);
    return NextResponse.json(instance);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
