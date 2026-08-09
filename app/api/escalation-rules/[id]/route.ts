import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { updateEscalationRule } from "@/lib/escalations/escalation-rule";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const rule = await updateEscalationRule(session, id, body);
    return NextResponse.json(rule);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
