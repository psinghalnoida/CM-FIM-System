import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import type { AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { DomainError } from "@/lib/domain-error";
import {
  assertCanManageDocumentsFor,
  assertCanReadDocumentsFor,
} from "@/lib/documents/link-scope";
import type { ExtractedField } from "@/lib/ocr/provider";

// BR-07: OCR-extracted fields are proposed values, never applied to
// master data until an authorized user explicitly reviews and confirms
// them — verifyOcrExtraction() below is that one explicit act. See
// docs/OCR.md for the full reasoning and why this is a single combined
// action rather than "verify" and "apply" as two separate steps.
//
// OcrExtraction has no organizationId column (like M6's Evidence and
// M7's WorkshopActivity before it) — access is resolved through
// DocumentVersion -> Document (which IS org-scoped) -> DocumentLink,
// never scopedDb() directly on this table.

const VEHICLE_APPLICABLE_FIELDS = [
  "registrationNumber",
  "chassisNumber",
  "engineNumber",
  "make",
  "model",
  "manufactureYear",
  "registrationDate",
] as const;

const DRIVER_APPLICABLE_FIELDS = [
  "name",
  "licenseNumber",
  "licenseExpiryDate",
] as const;

export function allowlistFor(linkedEntityType: string): readonly string[] {
  if (linkedEntityType === "VEHICLE") return VEHICLE_APPLICABLE_FIELDS;
  if (linkedEntityType === "DRIVER") return DRIVER_APPLICABLE_FIELDS;
  return [];
}

function coerceFieldValue(key: string, value: string): unknown {
  if (key === "manufactureYear") return Number(value);
  if (key === "registrationDate" || key === "licenseExpiryDate") {
    return new Date(value);
  }
  return value;
}

async function loadExtractionWithAccess(
  session: AuthSession,
  documentVersionId: string,
) {
  const version = await db.documentVersion.findUniqueOrThrow({
    where: { id: documentVersionId },
    include: {
      document: { include: { links: true } },
      ocrExtraction: true,
    },
  });
  const document = version.document;
  if (document.organizationId !== session.user.organizationId) {
    // Deliberately a 404 DomainError, not forbidden() — don't confirm
    // cross-org existence (same as M6's getEvidenceDownloadUrl()).
    throw new DomainError("Document version not found.", 404);
  }
  const link = document.links[0];
  if (!link) throw new Error("Document has no link to check access against.");
  return { link, extraction: version.ocrExtraction };
}

export async function getOcrExtraction(
  session: AuthSession,
  documentVersionId: string,
) {
  const { link, extraction } = await loadExtractionWithAccess(
    session,
    documentVersionId,
  );
  await assertCanReadDocumentsFor(
    session,
    link.linkedEntityType,
    link.linkedEntityId,
  );
  return extraction;
}

export const VerifyOcrExtractionSchema = z.object({
  applyFieldKeys: z.array(z.string()).default([]),
});
export type VerifyOcrExtractionInput = z.infer<
  typeof VerifyOcrExtractionSchema
>;

export async function verifyOcrExtraction(
  session: AuthSession,
  documentVersionId: string,
  input: unknown,
) {
  const data = VerifyOcrExtractionSchema.parse(input);
  const { link, extraction } = await loadExtractionWithAccess(
    session,
    documentVersionId,
  );
  await assertCanManageDocumentsFor(
    session,
    link.linkedEntityType,
    link.linkedEntityId,
  );

  if (!extraction) {
    throw new DomainError(
      "No OCR extraction exists for this document version.",
      404,
    );
  }
  if (extraction.status !== "EXTRACTED") {
    throw new DomainError(
      `Cannot verify an extraction that is ${extraction.status}.`,
      409,
    );
  }

  const extractedFields =
    (extraction.extractedFields as unknown as ExtractedField[] | null) ?? [];
  const allowlist = allowlistFor(link.linkedEntityType);
  // Unselected AND unmapped-for-this-entity-type fields are both simply
  // not applied — no error, this is the normal case (e.g. a Vehicle-
  // linked doc's fields never touch a Driver, nothing invalid happened).
  const toApply = extractedFields.filter(
    (field) =>
      data.applyFieldKeys.includes(field.key) && allowlist.includes(field.key),
  );

  if (toApply.length > 0) {
    const updateData = Object.fromEntries(
      toApply.map((field) => [
        field.key,
        coerceFieldValue(field.key, field.value),
      ]),
    );
    const scoped = scopedDb(session.user.organizationId);
    if (link.linkedEntityType === "VEHICLE") {
      const before = await scoped.vehicle.findUniqueOrThrow({
        where: { id: link.linkedEntityId },
      });
      const vehicle = await scoped.vehicle.update({
        where: { id: link.linkedEntityId },
        data: updateData,
      });
      await recordAudit({
        organizationId: session.user.organizationId,
        entityType: "Vehicle",
        entityId: vehicle.id,
        action: "UPDATE",
        actorId: session.user.id,
        beforeData: before,
        afterData: vehicle,
        sourceChannel: "WEB",
      });
    } else if (link.linkedEntityType === "DRIVER") {
      const before = await scoped.driver.findUniqueOrThrow({
        where: { id: link.linkedEntityId },
      });
      const driver = await scoped.driver.update({
        where: { id: link.linkedEntityId },
        data: updateData,
      });
      await recordAudit({
        organizationId: session.user.organizationId,
        entityType: "Driver",
        entityId: driver.id,
        action: "UPDATE",
        actorId: session.user.id,
        beforeData: before,
        afterData: driver,
        sourceChannel: "WEB",
      });
    }
  }

  const updated = await db.ocrExtraction.update({
    where: { documentVersionId },
    data: {
      status: "VERIFIED",
      verifiedById: session.user.id,
      verifiedAt: new Date(),
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "OcrExtraction",
    entityId: updated.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: "EXTRACTED" },
    afterData: {
      status: "VERIFIED",
      appliedFieldKeys: toApply.map((field) => field.key),
    },
    sourceChannel: "WEB",
  });

  return updated;
}

export async function rejectOcrExtraction(
  session: AuthSession,
  documentVersionId: string,
) {
  const { link, extraction } = await loadExtractionWithAccess(
    session,
    documentVersionId,
  );
  await assertCanManageDocumentsFor(
    session,
    link.linkedEntityType,
    link.linkedEntityId,
  );

  if (!extraction) {
    throw new DomainError(
      "No OCR extraction exists for this document version.",
      404,
    );
  }
  if (extraction.status !== "EXTRACTED") {
    throw new DomainError(
      `Cannot reject an extraction that is ${extraction.status}.`,
      409,
    );
  }

  const updated = await db.ocrExtraction.update({
    where: { documentVersionId },
    data: {
      status: "REJECTED",
      verifiedById: session.user.id,
      verifiedAt: new Date(),
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "OcrExtraction",
    entityId: updated.id,
    action: "STATUS_CHANGE",
    actorId: session.user.id,
    beforeData: { status: "EXTRACTED" },
    afterData: { status: "REJECTED" },
    sourceChannel: "WEB",
  });

  return updated;
}
