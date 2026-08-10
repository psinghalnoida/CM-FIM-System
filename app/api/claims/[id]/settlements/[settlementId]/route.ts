import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getSettlement } from "@/lib/settlements/settlement";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const session = await verifySession();
  const { settlementId } = await params;
  try {
    const settlement = await getSettlement(session, settlementId);
    if (!settlement)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(settlement);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
