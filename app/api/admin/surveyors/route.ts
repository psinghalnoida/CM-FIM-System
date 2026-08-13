import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { listSurveyors, createSurveyor } from "@/lib/masters/surveyor";

export async function GET() {
  const session = await verifySession();
  try {
    const surveyors = await listSurveyors(session);
    return NextResponse.json(surveyors);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const surveyor = await createSurveyor(session, body);
    return NextResponse.json(surveyor, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
