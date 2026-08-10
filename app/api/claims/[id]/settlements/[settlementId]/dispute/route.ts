import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { disputeSettlement } from "@/lib/settlements/settlement";

// M19: JBM disputes/raises a concern about the insurer's settlement
// offer — records a response, not a claim rejection. See docs/PAYMENTS.md.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const session = await verifySession();
  const { settlementId } = await params;
  try {
    const settlement = await disputeSettlement(session, settlementId);
    return NextResponse.json(settlement);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
