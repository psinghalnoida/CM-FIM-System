import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { presignEvidenceUpload } from "@/lib/incidents/evidence";

/** Step 1 of uploading evidence: get a presigned S3 PUT URL. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const result = await presignEvidenceUpload(session, id, body);
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
