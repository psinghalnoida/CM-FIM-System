import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getPayment } from "@/lib/settlements/payment";

export async function GET(
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
    const payment = await getPayment(session, paymentId);
    if (!payment)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(payment);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
