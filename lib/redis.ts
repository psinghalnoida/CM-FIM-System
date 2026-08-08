import { Redis } from "ioredis";

// Shared Redis connection, used by BullMQ queues (from the Next.js app, to
// enqueue jobs) and by the worker process (to consume them). BullMQ requires
// maxRetriesPerRequest: null on the connection it's given.
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not set. Copy .env.example to .env.");
  }
  return new Redis(url, { maxRetriesPerRequest: null });
}

export const redis = globalForRedis.redis ?? createRedisConnection();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
