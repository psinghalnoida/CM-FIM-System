import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { transitionClaimStatus } from "@/lib/claims/claim";
import { ClaimStatus } from "@/lib/generated/prisma/enums";

const BodySchema = z.object({ status: z.enum(ClaimStatus) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const { status } = BodySchema.parse(await request.json());
    const claim = await transitionClaimStatus(session, id, status);
    return NextResponse.json(claim);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
