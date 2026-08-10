import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, getDocumentsBucket } from "@/lib/s3";
import { db } from "@/lib/db";
import type {
  ExtractedField,
  OCRProvider,
  StorageRef,
} from "@/lib/ocr/provider";

// No "server-only" guard — see lib/ocr/queue.ts's comment; this module
// is dynamically imported by lib/ocr/provider.ts, which workers/index.ts
// (a standalone `tsx` script outside Next's build) imports transitively.

// Deterministic stub — no external calls, same documentVersionId always
// produces the same fields. What it "extracts" depends on the document's
// own type/linkage (looked up from the DB, not passed in — the fixed
// OCRProvider interface only takes documentVersionId/fileRef, so this is
// an implementation detail, not a contract change): REGISTRATION_CERTIFICATE
// docs linked to a Vehicle propose vehicle fields; DRIVING_LICENSE docs
// linked to a Driver propose driver fields; everything else proposes
// nothing, same as a real OCR engine finding nothing relevant on an
// unrelated document. See docs/OCR.md.

/** A short, deterministic, plausible-looking token derived from the version id — not random, so tests/demos are repeatable. */
function fakeToken(seed: string, label: string): string {
  return createHash("sha256")
    .update(`${seed}:${label}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
}

async function buildFieldsFor(
  documentVersionId: string,
): Promise<ExtractedField[]> {
  const version = await db.documentVersion.findUnique({
    where: { id: documentVersionId },
    include: { document: { include: { links: true } } },
  });
  const document = version?.document;
  const link = document?.links[0];
  if (!document || !link) return [];

  if (
    document.documentType === "REGISTRATION_CERTIFICATE" &&
    link.linkedEntityType === "VEHICLE"
  ) {
    return [
      {
        key: "registrationNumber",
        value: `KA01AB${fakeToken(documentVersionId, "reg").slice(0, 4)}`,
        confidence: 0.97,
      },
      {
        key: "chassisNumber",
        value: `CH${fakeToken(documentVersionId, "chassis")}`,
        confidence: 0.94,
      },
      {
        key: "engineNumber",
        value: `EN${fakeToken(documentVersionId, "engine")}`,
        confidence: 0.92,
      },
      { key: "make", value: "Tata", confidence: 0.99 },
      { key: "model", value: "Ace", confidence: 0.9 },
    ];
  }

  if (
    document.documentType === "DRIVING_LICENSE" &&
    link.linkedEntityType === "DRIVER"
  ) {
    return [
      {
        key: "name",
        value: `Driver ${fakeToken(documentVersionId, "name").slice(0, 4)}`,
        confidence: 0.93,
      },
      {
        key: "licenseNumber",
        value: `DL${fakeToken(documentVersionId, "license")}`,
        confidence: 0.96,
      },
    ];
  }

  return [];
}

export class StubOcrProvider implements OCRProvider {
  async extract(
    documentVersionId: string,
    fileRef: StorageRef,
  ): Promise<{ fields: ExtractedField[]; rawResponseRef: StorageRef }> {
    const fields = await buildFieldsFor(documentVersionId);

    // A real Textract call returns a raw JSON response worth keeping for
    // audit/debugging even after the structured fields are extracted from
    // it — the stub writes an equivalent (fabricated) JSON blob to the
    // same bucket so rawResponseStorageKey points at something real,
    // rather than a key nothing ever wrote.
    const rawResponseKey = `ocr-raw/${documentVersionId}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: getDocumentsBucket(),
        Key: rawResponseKey,
        Body: JSON.stringify(
          { provider: "stub", documentVersionId, sourceFile: fileRef, fields },
          null,
          2,
        ),
        ContentType: "application/json",
      }),
    );

    return {
      fields,
      rawResponseRef: { bucket: getDocumentsBucket(), key: rawResponseKey },
    };
  }
}
