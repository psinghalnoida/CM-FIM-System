import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createClaim, listClaims } from "@/lib/claims/claim";
import { ClaimStatus } from "@/lib/generated/prisma/enums";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const status = request.nextUrl.searchParams.get("status");
    const incidentId = request.nextUrl.searchParams.get("incidentId");
    const claims = await listClaims(session, {
      status:
        status && status in ClaimStatus
          ? (status as keyof typeof ClaimStatus)
          : undefined,
      incidentId: incidentId ?? undefined,
    });
    return NextResponse.json(claims);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const claim = await createClaim(session, body);
    return NextResponse.json(claim, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
