import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import { getDocument } from "@/lib/documents/document";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifySession();
  const { id } = await params;
  try {
    const document = await getDocument(session, id);
    if (!document)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(document);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
