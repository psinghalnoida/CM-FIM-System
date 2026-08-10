import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getDocument } from "@/lib/documents/document";
import { getOcrExtraction, allowlistFor } from "@/lib/ocr/verification";
import {
  OcrVerificationForm,
  type OcrFieldRow,
} from "@/components/documents/ocr-verification-form";
import type { ExtractedField } from "@/lib/ocr/provider";

// Demo page proving M11's OCR pipeline end-to-end — not a polished
// verification UI. See docs/OCR.md for what's deferred.
export default async function DocumentOcrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  const { id } = await params;

  const document = await getDocument(session, id);
  if (!document) notFound();

  if (!document.currentVersion) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <p className="text-muted-foreground text-sm">
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

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link
        href="/vehicles"
        className="text-primary text-sm underline underline-offset-4"
      >
        ← Vehicles
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">
        OCR — {document.title}
      </h1>

      <p className="text-muted-foreground mb-4 text-sm">
        Status: {extraction?.status ?? "—"} · v
        {document.currentVersion.versionNumber} ·{" "}
        {document.currentVersion.fileName}
      </p>

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
        <p className="text-muted-foreground text-sm">
          Verified{" "}
          {extraction.verifiedAt &&
            `on ${new Date(extraction.verifiedAt).toLocaleString()}`}
          .
        </p>
      )}
      {extraction?.status === "REJECTED" && (
        <p className="text-muted-foreground text-sm">
          Rejected — no fields were applied to master data.
        </p>
      )}
    </div>
  );
}
