import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { getIntegrationStatuses } from "@/lib/integrations/status";

// M29: deliberately unauthenticated — no verifySession() call. Closes the
// gap docs/DEPLOYMENT.md flagged: an unauthenticated GET /login only
// proves the process is up, not that Postgres/Redis are actually
// reachable. A liveness/readiness probe needs to hit this without a
// session. proxy.ts's matcher only covers page routes, not /api/*, so
// this needs no proxy change to stay public.
export async function GET() {
  const [database, redisCheck, integrations] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    getIntegrationStatuses(),
  ]);

  const ok =
    database.ok &&
    redisCheck.ok &&
    integrations.every((i) => i.health !== "MISCONFIGURED");

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks: { database, redis: redisCheck },
      integrations,
    },
    { status: ok ? 200 : 503 },
  );
}

async function checkDatabase(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(): Promise<{ ok: boolean; detail?: string }> {
  try {
    await redis.ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
