import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getDownloadUrl } from "@/lib/documents/document";

/** Returns a short-lived presigned GET URL for the document's current version — never a public bucket. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const result = await getDownloadUrl(session, id);
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
