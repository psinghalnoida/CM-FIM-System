import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  createSettlement,
  listSettlementsForClaim,
} from "@/lib/settlements/settlement";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const settlements = await listSettlementsForClaim(session, id);
    return NextResponse.json(settlements);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const settlement = await createSettlement(session, {
      ...body,
      claimId: id,
    });
    return NextResponse.json(settlement, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
