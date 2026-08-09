import "server-only";

export const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Reads a max-upload-size override from the given env var, read fresh on
 * every call (not cached) so tests can override it per-case without
 * needing a 100MB fixture — see docs/DOCUMENTS.md. Shared by
 * lib/documents/document.ts (DOCUMENT_MAX_FILE_SIZE_BYTES) and
 * lib/incidents/evidence.ts (EVIDENCE_MAX_FILE_SIZE_BYTES) rather than
 * each reimplementing the same parsing.
 */
export function getMaxUploadSizeBytes(envVarName: string): number {
  const override = process.env[envVarName];
  if (!override) return DEFAULT_MAX_UPLOAD_SIZE_BYTES;
  const parsed = Number(override);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_UPLOAD_SIZE_BYTES;
}
