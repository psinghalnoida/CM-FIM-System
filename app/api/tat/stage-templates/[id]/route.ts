import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  getStageTemplate,
  updateStageTemplate,
} from "@/lib/tat/stage-template";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const template = await getStageTemplate(session, id);
    if (!template)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(template);
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
    const template = await updateStageTemplate(session, id, body);
    return NextResponse.json(template);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
