import { Queue } from "bullmq";
import { redis } from "@/lib/redis";

// No "server-only" guard here (like lib/db.ts/lib/redis.ts): this module
// is imported both from the Next.js app (to enqueue, via
// lib/documents/document.ts) AND from workers/index.ts, which runs as a
// standalone `tsx` script outside Next's build — "server-only" throws
// when loaded there, since Next's own bundler is what normally strips/
// allows the marker. Found the hard way: the worker crashed on boot
// until this was removed. See docs/OCR.md.

// Async extraction (M11): completing a document/version upload enqueues a
// job here; workers/index.ts's worker (not this file — this file only
// runs from the Next.js app, to enqueue) picks it up and runs
// lib/ocr/process-extraction.ts. See docs/OCR.md.

export const OCR_EXTRACTION_QUEUE = "ocr-extraction";

export interface OcrExtractionJobData {
  documentVersionId: string;
}

const globalForOcrQueue = globalThis as unknown as {
  ocrExtractionQueue: Queue<OcrExtractionJobData> | undefined;
};

export const ocrExtractionQueue =
  globalForOcrQueue.ocrExtractionQueue ??
  new Queue<OcrExtractionJobData>(OCR_EXTRACTION_QUEUE, { connection: redis });

if (process.env.NODE_ENV !== "production") {
  globalForOcrQueue.ocrExtractionQueue = ocrExtractionQueue;
}

export async function enqueueOcrExtraction(
  documentVersionId: string,
): Promise<void> {
  await ocrExtractionQueue.add("extract", { documentVersionId });
}
