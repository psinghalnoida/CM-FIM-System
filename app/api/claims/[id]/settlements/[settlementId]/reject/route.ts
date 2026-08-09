import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { rejectSettlement } from "@/lib/settlements/settlement";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const session = await verifySession();
  const { settlementId } = await params;
  try {
    const settlement = await rejectSettlement(session, settlementId);
    return NextResponse.json(settlement);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
