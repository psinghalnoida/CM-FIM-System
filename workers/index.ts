// CM FIM System — background worker process entrypoint.
//
// Foundations (M1) only: this proves the worker process boots and can talk
// to Redis via BullMQ. Real queues (OCR extraction, TAT reminders/
// escalations, telematics snapshot capture, etc.) are added in their owning
// milestones — see docs/SCOPE.md — not invented here ahead of need.

import { Queue, Worker } from "bullmq";
import { redis } from "@/lib/redis";

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

async function shutdown() {
  console.log("[worker] shutting down");
  await worker.close();
  await healthcheckQueue.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Prove end-to-end wiring on boot: enqueue one healthcheck job for the
// worker above to pick up.
void healthcheckQueue.add("boot", { bootedAt: new Date().toISOString() });
