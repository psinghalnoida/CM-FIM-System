import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  createPayment,
  listPaymentsForSettlement,
} from "@/lib/settlements/payment";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const session = await verifySession();
  const { settlementId } = await params;
  try {
    const payments = await listPaymentsForSettlement(session, settlementId);
    return NextResponse.json(payments);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; settlementId: string }> },
) {
  const session = await verifySession();
  const { settlementId } = await params;
  try {
    const body = await request.json();
    const payment = await createPayment(session, {
      ...body,
      settlementId,
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
