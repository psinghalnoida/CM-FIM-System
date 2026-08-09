import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getClaim, updateClaim } from "@/lib/claims/claim";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const claim = await getClaim(session, id);
    if (!claim)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(claim);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const claim = await updateClaim(session, id, body);
    return NextResponse.json(claim);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
