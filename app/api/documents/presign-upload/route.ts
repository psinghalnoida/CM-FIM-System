import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { presignDocumentUpload } from "@/lib/documents/document";

/** Step 1 of uploading a brand-new document: get a presigned S3 PUT URL. */
export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const result = await presignDocumentUpload(session, body);
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
