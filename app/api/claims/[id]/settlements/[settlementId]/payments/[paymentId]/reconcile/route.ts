import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { reconcilePayment } from "@/lib/settlements/payment";

export async function POST(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; settlementId: string; paymentId: string }>;
  },
) {
  const session = await verifySession();
  const { paymentId } = await params;
  try {
    const payment = await reconcilePayment(session, paymentId);
    return NextResponse.json(payment);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
