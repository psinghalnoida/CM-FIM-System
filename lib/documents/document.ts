import "server-only";
import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { s3, getDocumentsBucket } from "@/lib/s3";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/scoped-db";
import type { AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { getMaxUploadSizeBytes } from "@/lib/upload-limits";
import { DomainError } from "@/lib/domain-error";
import {
  SUPPORTED_LINK_TYPES,
  assertCanManageDocumentsFor,
  assertCanReadDocumentsFor,
} from "@/lib/documents/link-scope";
import { enqueueOcrExtraction } from "@/lib/ocr/queue";
import { depotScopeFor } from "@/lib/masters/depot-scope";
import type { ExtractedField } from "@/lib/ocr/provider";
import { DocumentType } from "@/lib/generated/prisma/enums";

// BR-04: documents are versioned, never overwritten in place. Upload is a
// two-step presigned-URL flow (browser -> S3/MinIO directly) — see
// docs/DOCUMENTS.md for why, and what it does and doesn't guard against.

const PRESIGNED_URL_TTL_SECONDS = 300; // 5 minutes

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
}

function newStorageKey(fileName: string): string {
  return `documents/${randomUUID()}-${sanitizeFileName(fileName)}`;
}

async function presignPutUrl(storageKey: string): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: getDocumentsBucket(), Key: storageKey }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
}

/**
 * The authoritative size/content-type come from S3 itself (HeadObject),
 * never from client-reported values — a client could otherwise lie about
 * either. Used at "complete" time, after the browser has already PUT the
 * file directly to S3.
 */
async function headUploadedObject(storageKey: string) {
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: getDocumentsBucket(), Key: storageKey }),
  );
  return {
    contentLength: head.ContentLength ?? 0,
    contentType: head.ContentType ?? "application/octet-stream",
  };
}

async function deleteUploadedObject(storageKey: string): Promise<void> {
  await s3
    .send(
      new DeleteObjectCommand({
        Bucket: getDocumentsBucket(),
        Key: storageKey,
      }),
    )
    .catch(() => {
      // Best-effort cleanup of a rejected oversized upload — not worth
      // failing the request over.
    });
}

async function assertWithinSizeLimit(
  storageKey: string,
  contentLength: number,
): Promise<void> {
  const maxFileSizeBytes = getMaxUploadSizeBytes(
    "DOCUMENT_MAX_FILE_SIZE_BYTES",
  );
  if (contentLength > maxFileSizeBytes) {
    await deleteUploadedObject(storageKey);
    throw new DomainError(
      `Uploaded file (${contentLength} bytes) exceeds the ${maxFileSizeBytes}-byte limit.`,
    );
  }
}

// --- Presign (step 1: get a URL to upload directly to) ---------------------

export const PresignUploadSchema = z.object({
  linkedEntityType: z.enum(SUPPORTED_LINK_TYPES),
  linkedEntityId: z.uuid(),
  fileName: z.string().trim().min(1).max(200),
});
export type PresignUploadInput = z.infer<typeof PresignUploadSchema>;

/** Presign for a brand-new document (no Document row exists yet). */
export async function presignDocumentUpload(
  session: AuthSession,
  input: PresignUploadInput,
) {
  const data = PresignUploadSchema.parse(input);
  await assertCanManageDocumentsFor(
    session,
    data.linkedEntityType,
    data.linkedEntityId,
  );

  const storageKey = newStorageKey(data.fileName);
  const uploadUrl = await presignPutUrl(storageKey);
  return { uploadUrl, storageKey, expiresInSeconds: PRESIGNED_URL_TTL_SECONDS };
}

/** Presign for a new version of an existing document. */
export async function presignVersionUpload(
  session: AuthSession,
  documentId: string,
  fileName: string,
) {
  const scoped = scopedDb(session.user.organizationId);
  const document = await scoped.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { links: true },
  });
  const link = document.links[0];
  if (!link) throw new Error("Document has no link to check access against.");
  await assertCanManageDocumentsFor(
    session,
    link.linkedEntityType,
    link.linkedEntityId,
  );

  const storageKey = newStorageKey(fileName);
  const uploadUrl = await presignPutUrl(storageKey);
  return { uploadUrl, storageKey, expiresInSeconds: PRESIGNED_URL_TTL_SECONDS };
}

// --- Complete (step 2: the file is in S3 — record it) ----------------------

export const CompleteNewDocumentSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().trim().min(1).max(200),
  documentType: z.enum(DocumentType),
  title: z.string().trim().min(1).max(200),
  linkedEntityType: z.enum(SUPPORTED_LINK_TYPES),
  linkedEntityId: z.uuid(),
  validityStartDate: z.coerce.date().optional(),
  validityExpiryDate: z.coerce.date().optional(),
});
export type CompleteNewDocumentInput = z.infer<
  typeof CompleteNewDocumentSchema
>;

/** Creates the Document + its first DocumentVersion + the DocumentLink, all at once. */
export async function completeNewDocumentUpload(
  session: AuthSession,
  input: CompleteNewDocumentInput,
) {
  const data = CompleteNewDocumentSchema.parse(input);
  await assertCanManageDocumentsFor(
    session,
    data.linkedEntityType,
    data.linkedEntityId,
  );

  const { contentLength, contentType } = await headUploadedObject(
    data.storageKey,
  );
  await assertWithinSizeLimit(data.storageKey, contentLength);

  // NOTE: interactive transactions don't support scopedDb (see
  // docs/AUTH.md) — organizationId is set explicitly on every create below.
  const document = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        organizationId: session.user.organizationId,
        documentType: data.documentType,
        title: data.title,
        validityStartDate: data.validityStartDate,
        validityExpiryDate: data.validityExpiryDate,
        createdById: session.user.id,
      },
    });
    const version = await tx.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: 1,
        storageBucket: getDocumentsBucket(),
        storageKey: data.storageKey,
        fileName: data.fileName,
        mimeType: contentType,
        fileSizeBytes: contentLength,
        uploadedById: session.user.id,
      },
    });
    await tx.document.update({
      where: { id: doc.id },
      data: { currentVersionId: version.id },
    });
    await tx.documentLink.create({
      data: {
        documentId: doc.id,
        linkedEntityType: data.linkedEntityType,
        linkedEntityId: data.linkedEntityId,
      },
    });
    // M11: eagerly create the OcrExtraction row (PENDING) so the document
    // immediately shows "extraction pending" without waiting on the
    // worker — the job (enqueued below, once this transaction commits)
    // fills it in. See docs/OCR.md.
    await tx.ocrExtraction.create({
      data: {
        documentVersionId: version.id,
        provider: process.env.OCR_PROVIDER ?? "stub",
      },
    });
    return doc;
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Document",
    entityId: document.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: {
      title: data.title,
      documentType: data.documentType,
      linkedEntityType: data.linkedEntityType,
      linkedEntityId: data.linkedEntityId,
    },
    sourceChannel: "WEB",
  });

  const created = (await getDocument(session, document.id))!;
  await enqueueOcrExtraction(created.currentVersionId!);
  // Non-null: we just created this document in the transaction above —
  // a null here would mean getDocument()'s own org-scoping is broken.
  return created;
}

export const CompleteNewVersionSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().trim().min(1).max(200),
});
export type CompleteNewVersionInput = z.infer<typeof CompleteNewVersionSchema>;

/** Adds a new version to an existing document and makes it current (BR-04). */
export async function completeNewVersionUpload(
  session: AuthSession,
  documentId: string,
  input: CompleteNewVersionInput,
) {
  const data = CompleteNewVersionSchema.parse(input);
  const scoped = scopedDb(session.user.organizationId);
  const document = await scoped.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { links: true },
  });
  const link = document.links[0];
  if (!link) throw new Error("Document has no link to check access against.");
  await assertCanManageDocumentsFor(
    session,
    link.linkedEntityType,
    link.linkedEntityId,
  );

  const { contentLength, contentType } = await headUploadedObject(
    data.storageKey,
  );
  await assertWithinSizeLimit(data.storageKey, contentLength);

  const version = await db.$transaction(async (tx) => {
    const latest = await tx.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
    });
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
    const v = await tx.documentVersion.create({
      data: {
        documentId,
        versionNumber: nextVersionNumber,
        storageBucket: getDocumentsBucket(),
        storageKey: data.storageKey,
        fileName: data.fileName,
        mimeType: contentType,
        fileSizeBytes: contentLength,
        uploadedById: session.user.id,
      },
    });
    await tx.document.update({
      where: { id: documentId },
      data: { currentVersionId: v.id },
    });
    // M11: same eager PENDING row as completeNewDocumentUpload — every
    // version gets its own extraction, versions are never re-OCR'd in
    // place any more than they're overwritten in place (BR-04).
    await tx.ocrExtraction.create({
      data: {
        documentVersionId: v.id,
        provider: process.env.OCR_PROVIDER ?? "stub",
      },
    });
    return v;
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Document",
    entityId: documentId,
    action: "UPDATE",
    actorId: session.user.id,
    beforeData: { currentVersionId: document.currentVersionId },
    afterData: {
      currentVersionId: version.id,
      versionNumber: version.versionNumber,
    },
    sourceChannel: "WEB",
  });

  await enqueueOcrExtraction(version.id);
  return version;
}

// --- Read --------------------------------------------------------------

export async function getDocument(session: AuthSession, id: string) {
  const scoped = scopedDb(session.user.organizationId);
  const document = await scoped.document.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      links: true,
      currentVersion: true,
    },
  });
  if (!document) return null;
  const link = document.links[0];
  if (link) {
    await assertCanReadDocumentsFor(
      session,
      link.linkedEntityType,
      link.linkedEntityId,
    );
  }
  return document;
}

export const ListDocumentsSchema = z.object({
  linkedEntityType: z.enum(SUPPORTED_LINK_TYPES),
  linkedEntityId: z.uuid(),
});
export type ListDocumentsInput = z.infer<typeof ListDocumentsSchema>;

export async function listDocumentsForEntity(
  session: AuthSession,
  input: unknown,
) {
  const data = ListDocumentsSchema.parse(input);
  await assertCanReadDocumentsFor(
    session,
    data.linkedEntityType,
    data.linkedEntityId,
  );

  const scoped = scopedDb(session.user.organizationId);
  return scoped.document.findMany({
    where: {
      links: {
        some: {
          linkedEntityType: data.linkedEntityType,
          linkedEntityId: data.linkedEntityId,
        },
      },
    },
    include: { currentVersion: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDownloadUrl(session: AuthSession, documentId: string) {
  const scoped = scopedDb(session.user.organizationId);
  const document = await scoped.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { currentVersion: true, links: true },
  });
  const link = document.links[0];
  if (link) {
    await assertCanReadDocumentsFor(
      session,
      link.linkedEntityType,
      link.linkedEntityId,
    );
  }
  if (!document.currentVersion) {
    throw new DomainError("Document has no uploaded version yet.", 409);
  }

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: document.currentVersion.storageBucket,
      Key: document.currentVersion.storageKey,
    }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
  return {
    downloadUrl,
    fileName: document.currentVersion.fileName,
    expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// M22: org-wide document list ("Document Repository")
// ---------------------------------------------------------------------------

export type VehicleDocumentStatus =
  | "VALID"
  | "EXPIRING_SOON"
  | "EXPIRED"
  | "NO_EXPIRY";

const EXPIRING_SOON_WINDOW_DAYS = 30;

export function computeExpiryStatus(
  expiry: Date | null,
  now: Date,
): VehicleDocumentStatus {
  if (!expiry) return "NO_EXPIRY";
  const days = (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (days < 0) return "EXPIRED";
  if (days <= EXPIRING_SOON_WINDOW_DAYS) return "EXPIRING_SOON";
  return "VALID";
}

/** The design shows a single "OCR confidence" number per document; extractedFields carries one per field, so this averages them. Null (not 0) when there's nothing to average — "no OCR yet" isn't the same as "0% confident." */
export function averageOcrConfidence(extractedFields: unknown): number | null {
  const fields = (extractedFields as ExtractedField[] | null) ?? [];
  if (fields.length === 0) return null;
  const avg =
    fields.reduce((sum, field) => sum + field.confidence, 0) / fields.length;
  return Math.round(avg * 100);
}

export interface VehicleDocumentRow {
  id: string;
  title: string;
  documentType: DocumentType;
  vehicleId: string;
  vehicleRegistration: string;
  depotId: string;
  depotName: string;
  validityExpiryDate: Date | null;
  status: VehicleDocumentStatus;
  ocrConfidencePercent: number | null;
  uploadedAt: Date | null;
}

export interface ListVehicleDocumentsFilter {
  search?: string;
  vehicleId?: string;
  documentType?: DocumentType;
  depotId?: string;
  status?: VehicleDocumentStatus;
}

/**
 * The "Document Repository" org-wide list — deliberately scoped to
 * VEHICLE-linked documents specifically (registration/insurance/
 * fitness/permit/PUC — compliance documents with an expiry date), not
 * every DocumentLink entity type. This matches the design's own columns
 * (bus number, expiry, OCR confidence) and mock data, which are 100%
 * vehicle-linked; documents linked to CLAIM/SURVEY/REPAIR_JOB/
 * SETTLEMENT/INCIDENT/DRIVER have no natural place in a "bus no. /
 * expiry" table and stay reachable only from their own entity's
 * Documents tab. A deliberate scope narrowing, not an oversight — see
 * docs/DOCUMENTS.md.
 */
export async function listVehicleDocuments(
  session: AuthSession,
  filter: ListVehicleDocumentsFilter = {},
): Promise<VehicleDocumentRow[]> {
  const scoped = scopedDb(session.user.organizationId);
  const depotScope = depotScopeFor(session);
  if (depotScope && filter.depotId && filter.depotId !== depotScope) {
    // Same "a filter for out-of-scope data returns empty, not a bypass"
    // call as lib/incidents/incident.ts's listIncidents (M21).
    return [];
  }

  const vehicles = await scoped.vehicle.findMany({
    where: {
      depotId: depotScope ?? filter.depotId,
      id: filter.vehicleId,
    },
    include: { depot: true },
  });
  if (vehicles.length === 0) return [];
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  // DocumentLink has no organizationId column (generic, no-FK by design
  // — see the schema file's top comment); org isolation here comes from
  // `vehicles` above (already org-scoped) plus this explicit filter.
  const links = await db.documentLink.findMany({
    where: {
      linkedEntityType: "VEHICLE",
      linkedEntityId: { in: [...vehicleById.keys()] },
      document: { organizationId: session.user.organizationId },
    },
    include: {
      document: {
        include: { currentVersion: { include: { ocrExtraction: true } } },
      },
    },
  });

  const now = new Date();
  return links
    .map((link) => {
      const vehicle = vehicleById.get(link.linkedEntityId)!;
      const doc = link.document;
      const row: VehicleDocumentRow = {
        id: doc.id,
        title: doc.title,
        documentType: doc.documentType,
        vehicleId: vehicle.id,
        vehicleRegistration: vehicle.registrationNumber,
        depotId: vehicle.depotId,
        depotName: vehicle.depot.name,
        validityExpiryDate: doc.validityExpiryDate,
        status: computeExpiryStatus(doc.validityExpiryDate, now),
        ocrConfidencePercent: averageOcrConfidence(
          doc.currentVersion?.ocrExtraction?.extractedFields,
        ),
        uploadedAt: doc.currentVersion?.createdAt ?? null,
      };
      return row;
    })
    .filter(
      (row) => !filter.documentType || row.documentType === filter.documentType,
    )
    .filter((row) => !filter.status || row.status === filter.status)
    .filter((row) => {
      if (!filter.search) return true;
      const needle = filter.search.toLowerCase();
      return (
        row.vehicleRegistration.toLowerCase().includes(needle) ||
        row.title.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => a.vehicleRegistration.localeCompare(b.vehicleRegistration));
}
