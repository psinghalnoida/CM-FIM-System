import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getOcrExtraction } from "@/lib/ocr/verification";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const session = await verifySession();
  const { versionId } = await params;
  try {
    const extraction = await getOcrExtraction(session, versionId);
    if (!extraction)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(extraction);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
