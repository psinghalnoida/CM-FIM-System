import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { createSurvey, listSurveysForClaim } from "@/lib/claims/survey";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const surveys = await listSurveysForClaim(session, id);
    return NextResponse.json(surveys);
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
    const survey = await createSurvey(session, { ...body, claimId: id });
    return NextResponse.json(survey, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
