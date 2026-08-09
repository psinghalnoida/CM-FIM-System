// CM FIM System — background worker process entrypoint.
//
// M1's healthcheck queue proves the worker process boots and can talk to
// Redis via BullMQ. Real queues are added in their owning milestones —
// see docs/SCOPE.md — not invented here ahead of need. M11 adds the OCR
// extraction queue; TAT reminders/escalations (M13) and telematics
// snapshot capture (M12) will each add their own worker below when built.

import { Queue, Worker } from "bullmq";
import { redis } from "@/lib/redis";
import {
  OCR_EXTRACTION_QUEUE,
  type OcrExtractionJobData,
} from "@/lib/ocr/queue";
import { processOcrExtractionJob } from "@/lib/ocr/process-extraction";

const HEALTHCHECK_QUEUE = "system-healthcheck";

const healthcheckQueue = new Queue(HEALTHCHECK_QUEUE, { connection: redis });

const worker = new Worker(
  HEALTHCHECK_QUEUE,
  async (job) => {
    console.log(`[worker] processed healthcheck job ${job.id}`, job.data);
    return { ok: true, at: new Date().toISOString() };
  },
  { connection: redis },
);

worker.on("ready", () => {
  console.log("[worker] connected to Redis, waiting for jobs");
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err);
});

const ocrWorker = new Worker<OcrExtractionJobData>(
  OCR_EXTRACTION_QUEUE,
  async (job) => {
    await processOcrExtractionJob(job.data.documentVersionId);
    return { ok: true };
  },
  { connection: redis },
);

ocrWorker.on("ready", () => {
  console.log("[worker] ocr-extraction: connected to Redis, waiting for jobs");
});

ocrWorker.on("failed", (job, err) => {
  console.error(`[worker] ocr-extraction job ${job?.id} failed:`, err);
});

async function shutdown() {
  console.log("[worker] shutting down");
  await worker.close();
  await healthcheckQueue.close();
  await ocrWorker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Prove end-to-end wiring on boot: enqueue one healthcheck job for the
// worker above to pick up.
void healthcheckQueue.add("boot", { bootedAt: new Date().toISOString() });
