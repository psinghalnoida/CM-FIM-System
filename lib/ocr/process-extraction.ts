import { db } from "@/lib/db";
import { getOcrProvider } from "@/lib/ocr/provider";

// No "server-only" guard — see lib/ocr/queue.ts's comment; this module is
// imported by workers/index.ts, a standalone `tsx` script outside Next's
// build.
//
// The actual job body — imported by workers/index.ts's worker, not run
// directly from the Next.js app (that side only enqueues, via
// lib/ocr/queue.ts). Kept in its own module so both the worker and any
// test can call it without pulling in BullMQ's Worker class.
export async function processOcrExtractionJob(
  documentVersionId: string,
): Promise<void> {
  const version = await db.documentVersion.findUniqueOrThrow({
    where: { id: documentVersionId },
  });

  const provider = await getOcrProvider();
  const result = await provider.extract(documentVersionId, {
    bucket: version.storageBucket,
    key: version.storageKey,
  });

  // The OcrExtraction row already exists (created PENDING at upload-
  // completion time, lib/documents/document.ts) — this fills it in, it
  // doesn't create it. If the provider throws, the row is deliberately
  // left PENDING rather than invented a FAILED status the schema doesn't
  // have; BullMQ's own retry/failure logging (workers/index.ts) covers
  // the failure itself.
  await db.ocrExtraction.update({
    where: { documentVersionId },
    data: {
      status: "EXTRACTED",
      extractedFields: result.fields as never,
      rawResponseStorageKey: result.rawResponseRef.key,
    },
  });
}
