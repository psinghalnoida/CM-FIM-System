import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getSurvey, updateSurvey } from "@/lib/claims/survey";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; surveyId: string }> },
) {
  const session = await verifySession();
  const { surveyId } = await params;
  try {
    const survey = await getSurvey(session, surveyId);
    if (!survey)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(survey);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; surveyId: string }> },
) {
  const session = await verifySession();
  const { surveyId } = await params;
  try {
    const body = await request.json();
    const survey = await updateSurvey(session, surveyId, body);
    return NextResponse.json(survey);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
