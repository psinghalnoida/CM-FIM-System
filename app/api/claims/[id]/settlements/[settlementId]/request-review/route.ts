import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { requestSettlementReview } from "@/lib/settlements/settlement";

// M19: JBM asks the insurer to review the settlement offer before
// deciding. See docs/PAYMENTS.md.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const session = await verifySession();
  const { settlementId } = await params;
  try {
    const settlement = await requestSettlementReview(session, settlementId);
    return NextResponse.json(settlement);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
