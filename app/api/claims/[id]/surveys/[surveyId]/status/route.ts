import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { transitionSurveyStatus } from "@/lib/claims/survey";
import { SurveyStatus } from "@/lib/generated/prisma/enums";

const BodySchema = z.object({ status: z.enum(SurveyStatus) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; surveyId: string }> },
) {
  const session = await verifySession();
  const { surveyId } = await params;
  try {
    const { status } = BodySchema.parse(await request.json());
    const survey = await transitionSurveyStatus(session, surveyId, status);
    return NextResponse.json(survey);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
