import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import {
  getDocument,
  computeExpiryStatus,
  averageOcrConfidence,
} from "@/lib/documents/document";
import { getOcrExtraction, allowlistFor } from "@/lib/ocr/verification";
import {
  OcrVerificationForm,
  type OcrFieldRow,
} from "@/components/documents/ocr-verification-form";
import { UploadNewVersionForm } from "@/components/documents/upload-new-version-form";
import { DownloadDocumentLink } from "@/components/documents/download-document-link";
import type { ExtractedField } from "@/lib/ocr/provider";
import type { VehicleDocumentStatus } from "@/lib/documents/document";

const STATUS_LABELS: Record<VehicleDocumentStatus, string> = {
  VALID: "Valid",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  NO_EXPIRY: "No expiry",
};
const STATUS_CLASSES: Record<VehicleDocumentStatus, string> = {
  VALID: "bg-status-green-bg text-status-green-fg",
  EXPIRING_SOON: "bg-status-amber-bg text-status-amber-fg",
  EXPIRED: "bg-status-red-bg text-status-red-fg",
  NO_EXPIRY: "bg-muted text-muted-foreground",
};

// M22: the "Document Viewer" restyled to the design — metadata grid, an
// OCR confidence bar, and Verify/Flag-for-review/Request-re-upload
// actions. The underlying verification mechanism is unchanged from M11
// (OcrVerificationForm's field-by-field selection, per BR-07 — a single
// "Verify document" button that blanket-applies everything would
// contradict the whole point of human verification). See docs/OCR.md
// and docs/DOCUMENTS.md's M22 update.
export default async function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;

  const document = await getDocument(session, id);
  if (!document) notFound();

  const status = computeExpiryStatus(document.validityExpiryDate, new Date());

  if (!document.currentVersion) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Link
          href="/documents"
          className="text-primary text-sm underline underline-offset-4"
        >
          ← Documents
        </Link>
        <p className="text-muted-foreground mt-4 text-sm">
          This document has no uploaded version yet.
        </p>
      </div>
    );
  }

  const extraction = await getOcrExtraction(
    session,
    document.currentVersion.id,
  );
  const linkedEntityType = document.links[0]?.linkedEntityType;
  const allowlist = linkedEntityType ? allowlistFor(linkedEntityType) : [];

  const fields: OcrFieldRow[] = (
    (extraction?.extractedFields as unknown as ExtractedField[] | null) ?? []
  ).map((field) => ({
    ...field,
    applicable: allowlist.includes(field.key),
  }));
  const confidence = averageOcrConfidence(extraction?.extractedFields);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href="/documents"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Documents
      </Link>

      <div className="mt-2 mb-4 flex items-start justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {document.documentType.replaceAll("_", " ")}
          </h1>
          <p className="text-muted-foreground text-sm">{document.title}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">File</dt>
        <dd>{document.currentVersion.fileName}</dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd>v{document.currentVersion.versionNumber}</dd>
        <dt className="text-muted-foreground">Expiry date</dt>
        <dd>
          {document.validityExpiryDate
            ? new Date(document.validityExpiryDate).toLocaleDateString()
            : "—"}
        </dd>
        <dt className="text-muted-foreground">Uploaded</dt>
        <dd>{new Date(document.currentVersion.createdAt).toLocaleDateString()}</dd>
        <dt className="text-muted-foreground">Verified</dt>
        <dd>
          {extraction?.status === "VERIFIED" && extraction.verifiedAt
            ? new Date(extraction.verifiedAt).toLocaleDateString()
            : "—"}
        </dd>
        <dt className="text-muted-foreground">Download</dt>
        <dd>
          <DownloadDocumentLink documentId={document.id} />
        </dd>
      </div>

      <div className="mt-6">
        <div className="text-muted-foreground mb-1 text-xs">
          OCR confidence
        </div>
        <div className="flex max-w-sm items-center gap-3">
          <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full"
              style={{ width: `${confidence ?? 0}%` }}
            />
          </div>
          <div className="min-w-10 text-sm font-semibold">
            {confidence === null ? "—" : `${confidence}%`}
          </div>
        </div>
      </div>

      <div className="mt-6">
        {!extraction && (
          <p className="text-muted-foreground text-sm">
            No OCR extraction exists for this version.
          </p>
        )}
        {extraction?.status === "PENDING" && (
          <p className="text-muted-foreground text-sm">
            Extraction queued — check back shortly.
          </p>
        )}
        {extraction?.status === "EXTRACTED" && (
          <OcrVerificationForm
            documentId={document.id}
            versionId={document.currentVersion.id}
            fields={fields}
          />
        )}
        {extraction?.status === "VERIFIED" && (
          <p className="text-muted-foreground text-sm">Verified.</p>
        )}
        {extraction?.status === "REJECTED" && (
          <p className="text-muted-foreground text-sm">
            Flagged for review — no fields were applied to master data.
          </p>
        )}
      </div>

      <div className="mt-4">
        <UploadNewVersionForm documentId={document.id} />
      </div>
    </div>
  );
}
