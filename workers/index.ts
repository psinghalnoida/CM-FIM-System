// CM FIM System — background worker process entrypoint.
//
// M1's healthcheck queue proves the worker process boots and can talk to
// Redis via BullMQ. Real queues are added in their owning milestones —
// see docs/SCOPE.md — not invented here ahead of need. M11 adds the OCR
// extraction queue; M13 adds the escalation reminder scheduler; telematics
// snapshot capture (M12) will add its own worker below when built.

import { Queue, Worker } from "bullmq";
import { redis } from "@/lib/redis";
import {
  OCR_EXTRACTION_QUEUE,
  type OcrExtractionJobData,
} from "@/lib/ocr/queue";
import { processOcrExtractionJob } from "@/lib/ocr/process-extraction";
import { scanAndFireEscalations } from "@/lib/escalations/scan";

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

// PR-03's reminder scheduler: a repeatable job, not a one-shot enqueue —
// BullMQ re-schedules the next run itself. Every 15 minutes is a
// reasonable default for a TAT measured in hours, not a tuned SLA
// parameter; revisit if a real need for finer granularity shows up.
const ESCALATION_SCAN_QUEUE = "escalation-scan";
const ESCALATION_SCAN_INTERVAL_MS = 15 * 60 * 1000;

const escalationScanQueue = new Queue(ESCALATION_SCAN_QUEUE, {
  connection: redis,
});

const escalationScanWorker = new Worker(
  ESCALATION_SCAN_QUEUE,
  async () => {
    const result = await scanAndFireEscalations();
    console.log(
      `[worker] escalation-scan: ${result.breachedStageCount} breached stage(s), ${result.fired.length} escalation(s) fired, ${result.skippedNonEmailCount} skipped (non-EMAIL channel)`,
    );
    return result;
  },
  { connection: redis },
);

escalationScanWorker.on("ready", () => {
  console.log("[worker] escalation-scan: connected to Redis, waiting for jobs");
});

escalationScanWorker.on("failed", (job, err) => {
  console.error(`[worker] escalation-scan job ${job?.id} failed:`, err);
});

async function shutdown() {
  console.log("[worker] shutting down");
  await worker.close();
  await healthcheckQueue.close();
  await ocrWorker.close();
  await escalationScanWorker.close();
  await escalationScanQueue.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Prove end-to-end wiring on boot: enqueue one healthcheck job for the
// worker above to pick up.
void healthcheckQueue.add("boot", { bootedAt: new Date().toISOString() });

// Recurring scan every ESCALATION_SCAN_INTERVAL_MS (BullMQ 6's job-
// scheduler API — the older `repeat` option on `.add()` was removed).
// Also fire once immediately on boot so ops don't wait 15 minutes to see
// the first sweep.
void escalationScanQueue.upsertJobScheduler("escalation-scan", {
  every: ESCALATION_SCAN_INTERVAL_MS,
});
void escalationScanQueue.add("scan-now", {});
