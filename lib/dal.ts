import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { unauthorized, forbidden } from "next/navigation";
import {
  decryptSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/session-crypto";
import { getActiveDbSession } from "@/lib/session-service";
import type { UserRole } from "@/lib/generated/prisma/enums";

/**
 * Data Access Layer — the one place that turns "a request came in" into
 * "here is the authenticated user, or there isn't one". Every protected
 * Server Component, Server Action, and Route Handler goes through this,
 * not through reading the cookie directly — see docs/AUTH.md.
 *
 * cache() memoizes per request: multiple components calling getSession()
 * during the same render only hit the database once.
 */
export const getSession = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = await decryptSessionCookie(token);
  if (!payload) return null;

  const dbSession = await getActiveDbSession(payload.sessionId);
  if (!dbSession) return null;

  return dbSession;
});

/** The shape verifySession()/getSession() resolve to when a session exists — the Session row plus its User. Domain services (lib/masters/*, ...) take this as their auth context rather than re-deriving it. */
export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof getActiveDbSession>>
>;

/**
 * Like getSession(), but for routes/actions that require a signed-in user:
 * throws Next's unauthorized() (401) instead of returning null. Call this,
 * not getSession(), whenever "no session" should stop the request.
 */
export async function verifySession() {
  const session = await getSession();
  if (!session) {
    unauthorized();
  }
  return session;
}

/**
 * Role gate. Throws Next's forbidden() (403) if the session's user role
 * isn't one of `allowedRoles`. This is deliberately a per-call check, not
 * a precomputed permission matrix — see docs/AUTH.md for why: with no
 * business modules built yet (M4+), inventing granular permissions ahead
 * of the actions that need them risks getting it wrong and redoing it.
 * Each module defines its own allowed-roles list as it's built.
 */
export function requireRole(
  session: { user: { role: UserRole } },
  ...allowedRoles: UserRole[]
) {
  if (!allowedRoles.includes(session.user.role)) {
    forbidden();
  }
}
