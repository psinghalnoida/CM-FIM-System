import { db } from "@/lib/db";
import type {
  AuditAction,
  AuditSourceChannel,
} from "@/lib/generated/prisma/enums";

// No "server-only" guard (like lib/db.ts): this module is imported both
// from the Next.js app AND, since M13, from workers/index.ts via
// lib/escalations/scan.ts — a standalone `tsx` script outside Next's
// build, where the guard's fallback throws (docs/OCR.md's M11 lesson,
// applied here before it could bite the same way twice).
//
// BR-08: every important user action creates an audit record. This is the
// single write path for AuditLog — domain services call recordAudit()
// rather than writing db.auditLog.create(...) themselves, so every audit
// entry is shaped the same way regardless of which module wrote it.
export interface RecordAuditInput {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  sourceChannel: AuditSourceChannel;
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actorId ?? null,
      // JSON columns — beforeData/afterData are caller-supplied plain
      // objects, not typed against Prisma's generated JSON input here.
      beforeData: input.beforeData as never,
      afterData: input.afterData as never,
      sourceChannel: input.sourceChannel,
    },
  });
}
