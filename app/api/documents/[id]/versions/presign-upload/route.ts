import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { presignVersionUpload } from "@/lib/documents/document";

/** Step 1 of uploading a new version of an existing document. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const body = await request.json();
    const result = await presignVersionUpload(session, id, body.fileName);
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
