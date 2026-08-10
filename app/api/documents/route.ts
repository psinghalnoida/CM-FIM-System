import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { toApiErrorResponse } from "@/lib/api-errors";
import {
  completeNewDocumentUpload,
  listDocumentsForEntity,
  listVehicleDocuments,
  type VehicleDocumentStatus,
} from "@/lib/documents/document";
import { DocumentType } from "@/lib/generated/prisma/enums";

const VEHICLE_DOCUMENT_STATUSES: VehicleDocumentStatus[] = [
  "VALID",
  "EXPIRING_SOON",
  "EXPIRED",
  "NO_EXPIRY",
];

/**
 * ?linkedEntityType=VEHICLE&linkedEntityId=... lists one entity's
 * documents (M5). Omitting both instead lists the M22 org-wide
 * "Document Repository" (vehicle-linked documents only — see
 * lib/documents/document.ts's listVehicleDocuments doc comment),
 * filterable by ?search=&vehicleId=&documentType=&depotId=&status=.
 */
export async function GET(request: NextRequest) {
  const session = await verifySession();
  const { searchParams } = request.nextUrl;
  const linkedEntityType = searchParams.get("linkedEntityType");
  const linkedEntityId = searchParams.get("linkedEntityId");
  try {
    if (!linkedEntityType && !linkedEntityId) {
      const documentType = searchParams.get("documentType");
      const status = searchParams.get("status");
      const documents = await listVehicleDocuments(session, {
        search: searchParams.get("search") ?? undefined,
        vehicleId: searchParams.get("vehicleId") ?? undefined,
        depotId: searchParams.get("depotId") ?? undefined,
        documentType:
          documentType && documentType in DocumentType
            ? (documentType as DocumentType)
            : undefined,
        status: VEHICLE_DOCUMENT_STATUSES.find((s) => s === status),
      });
      return NextResponse.json(documents);
    }
    const documents = await listDocumentsForEntity(session, {
      linkedEntityType,
      linkedEntityId,
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
