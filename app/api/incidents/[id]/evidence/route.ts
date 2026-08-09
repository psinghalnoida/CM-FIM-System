import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { completeEvidenceUpload, listEvidence } from "@/lib/incidents/evidence";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const evidence = await listEvidence(session, id);
    return NextResponse.json(evidence);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

/** Step 2 of uploading evidence: record it after the S3 PUT succeeds. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const evidence = await completeEvidenceUpload(session, id, body);
    return NextResponse.json(evidence, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
