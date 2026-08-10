import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getEvidenceDownloadUrl } from "@/lib/incidents/evidence";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; evidenceId: string }> },
) {
  const session = await verifySession();
  const { evidenceId } = await params;
  try {
    const result = await getEvidenceDownloadUrl(session, evidenceId);
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
