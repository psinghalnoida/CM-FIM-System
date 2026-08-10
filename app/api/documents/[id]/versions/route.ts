import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { completeNewVersionUpload } from "@/lib/documents/document";

/** Step 2 of uploading a new version: record it after the S3 PUT succeeds. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const version = await completeNewVersionUpload(session, id, body);
    return NextResponse.json(version, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
