import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { verifyOcrExtraction } from "@/lib/ocr/verification";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const session = await verifySession();
  const { versionId } = await params;
  try {
    const body = await request.json();
    const extraction = await verifyOcrExtraction(session, versionId, body);
    return NextResponse.json(extraction);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
