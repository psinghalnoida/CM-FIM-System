import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { rejectOcrExtraction } from "@/lib/ocr/verification";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const session = await verifySession();
  const { versionId } = await params;
  try {
    const extraction = await rejectOcrExtraction(session, versionId);
    return NextResponse.json(extraction);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
