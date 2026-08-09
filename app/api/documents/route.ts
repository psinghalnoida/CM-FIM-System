import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  completeNewDocumentUpload,
  listDocumentsForEntity,
} from "@/lib/documents/document";

/** ?linkedEntityType=VEHICLE&linkedEntityId=... */
export async function GET(request: NextRequest) {
  const session = await verifySession();
  try {
    const { searchParams } = request.nextUrl;
    const documents = await listDocumentsForEntity(session, {
      linkedEntityType: searchParams.get("linkedEntityType"),
      linkedEntityId: searchParams.get("linkedEntityId"),
    });
    return NextResponse.json(documents);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

/** Step 2 of uploading a brand-new document: record it after the S3 PUT succeeds. */
export async function POST(request: NextRequest) {
  const session = await verifySession();
  try {
    const body = await request.json();
    const document = await completeNewDocumentUpload(session, body);
    return NextResponse.json(document, { status: 201 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
