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
import { requireRole, type AuthSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { assertDepotInScope } from "@/lib/masters/depot-scope";
import { getMaxUploadSizeBytes } from "@/lib/upload-limits";
import { DomainError } from "@/lib/domain-error";
import { EvidenceType } from "@/lib/generated/prisma/enums";

// Photo/video/document evidence attached to an incident — same presigned-
// URL flow as lib/documents/document.ts (see docs/DOCUMENTS.md for the
// full reasoning), but simpler: evidence isn't versioned, it's just
// captured once. See docs/INCIDENTS.md.

const PRESIGNED_URL_TTL_SECONDS = 300; // 5 minutes
const WRITE_ROLES = ["ORG_ADMIN", "DEPOT_MANAGER"] as const;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
}

function newStorageKey(fileName: string): string {
  return `evidence/${randomUUID()}-${sanitizeFileName(fileName)}`;
}

async function assertCanManageEvidenceFor(
  session: AuthSession,
  incidentId: string,
) {
  requireRole(session, ...WRITE_ROLES);
  const scoped = scopedDb(session.user.organizationId);
  const incident = await scoped.incident.findUniqueOrThrow({
    where: { id: incidentId },
  });
  assertDepotInScope(session, incident.depotId);
}

async function assertCanReadEvidenceFor(
  session: AuthSession,
  incidentId: string,
) {
  const scoped = scopedDb(session.user.organizationId);
  const incident = await scoped.incident.findUniqueOrThrow({
    where: { id: incidentId },
  });
  assertDepotInScope(session, incident.depotId);
}

export const PresignEvidenceUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
});

export async function presignEvidenceUpload(
  session: AuthSession,
  incidentId: string,
  input: z.infer<typeof PresignEvidenceUploadSchema>,
) {
  const data = PresignEvidenceUploadSchema.parse(input);
  await assertCanManageEvidenceFor(session, incidentId);

  const storageKey = newStorageKey(data.fileName);
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: getDocumentsBucket(), Key: storageKey }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
  return { uploadUrl, storageKey, expiresInSeconds: PRESIGNED_URL_TTL_SECONDS };
}

export const CompleteEvidenceUploadSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().trim().min(1).max(200),
  evidenceType: z.enum(EvidenceType),
  caption: z.string().trim().max(500).optional(),
});
export type CompleteEvidenceUploadInput = z.infer<
  typeof CompleteEvidenceUploadSchema
>;

export async function completeEvidenceUpload(
  session: AuthSession,
  incidentId: string,
  input: CompleteEvidenceUploadInput,
) {
  const data = CompleteEvidenceUploadSchema.parse(input);
  await assertCanManageEvidenceFor(session, incidentId);

  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: getDocumentsBucket(),
      Key: data.storageKey,
    }),
  );
  const contentLength = head.ContentLength ?? 0;
  const contentType = head.ContentType ?? "application/octet-stream";

  const maxSizeBytes = getMaxUploadSizeBytes("EVIDENCE_MAX_FILE_SIZE_BYTES");
  if (contentLength > maxSizeBytes) {
    await s3
      .send(
        new DeleteObjectCommand({
          Bucket: getDocumentsBucket(),
          Key: data.storageKey,
        }),
      )
      .catch(() => {});
    throw new DomainError(
      `Uploaded file (${contentLength} bytes) exceeds the ${maxSizeBytes}-byte limit.`,
    );
  }

  const scoped = scopedDb(session.user.organizationId);
  const evidence = await scoped.evidence.create({
    data: {
      incidentId,
      evidenceType: data.evidenceType,
      storageBucket: getDocumentsBucket(),
      storageKey: data.storageKey,
      fileName: data.fileName,
      mimeType: contentType,
      fileSizeBytes: contentLength,
      caption: data.caption,
      uploadedById: session.user.id,
    },
  });

  await recordAudit({
    organizationId: session.user.organizationId,
    entityType: "Evidence",
    entityId: evidence.id,
    action: "CREATE",
    actorId: session.user.id,
    afterData: {
      incidentId,
      evidenceType: data.evidenceType,
      fileName: data.fileName,
    },
    sourceChannel: "WEB",
  });

  return evidence;
}

export async function listEvidence(session: AuthSession, incidentId: string) {
  await assertCanReadEvidenceFor(session, incidentId);
  const scoped = scopedDb(session.user.organizationId);
  return scoped.evidence.findMany({
    where: { incidentId },
    orderBy: { uploadedAt: "desc" },
  });
}

export async function getEvidenceDownloadUrl(
  session: AuthSession,
  evidenceId: string,
) {
  // Evidence has no organizationId column (docs/schema/M2A.md), so
  // scopedDb() does NOT filter it — querying it directly here would leak
  // evidence across organizations. Resolve through its parent Incident
  // (which IS org-scoped) instead, via the plain client + an explicit org
  // check, exactly the gap ORG_SCOPED_MODELS/lib/scoped-db.guard.test.ts
  // exists to catch.
  const evidence = await db.evidence.findUniqueOrThrow({
    where: { id: evidenceId },
    include: { incident: true },
  });
  if (evidence.incident.organizationId !== session.user.organizationId) {
    // Deliberately a 404 DomainError, not forbidden() — don't confirm cross-org existence.
    throw new DomainError("Evidence not found.", 404);
  }
  assertDepotInScope(session, evidence.incident.depotId);

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: evidence.storageBucket,
      Key: evidence.storageKey,
    }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
  return {
    downloadUrl,
    fileName: evidence.fileName,
    expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
  };
}
