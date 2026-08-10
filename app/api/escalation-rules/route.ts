import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  createEscalationRule,
  listEscalationRulesForStageTemplate,
} from "@/lib/escalations/escalation-rule";
import { DomainError } from "@/lib/domain-error";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const stageTemplateId = request.nextUrl.searchParams.get("stageTemplateId");
    if (!stageTemplateId) {
      throw new DomainError("stageTemplateId is required.", 400);
    }
    const rules = await listEscalationRulesForStageTemplate(
      session,
      stageTemplateId,
    );
    return NextResponse.json(rules);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const rule = await createEscalationRule(session, body);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
