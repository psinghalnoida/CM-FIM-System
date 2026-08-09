import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  createStageTemplate,
  listStageTemplates,
} from "@/lib/tat/stage-template";
import { CaseType } from "@/lib/generated/prisma/enums";

export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const caseType = request.nextUrl.searchParams.get("caseType");
    const templates = await listStageTemplates(session, {
      caseType:
        caseType && caseType in CaseType ? (caseType as CaseType) : undefined,
    });
    return NextResponse.json(templates);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const template = await createStageTemplate(session, body);
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
