import "server-only";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { SESSION_TTL_SECONDS } from "@/lib/session-crypto";
import { recordAudit } from "@/lib/audit";

/**
 * Verifies email/password against the User table. Returns the user on
 * success, null on any failure (unknown email, wrong password, inactive
 * account, no password set) — deliberately not distinguishing which, so
 * the login form can't be used to enumerate valid emails.
 */
export async function verifyCredentials(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) {
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

/** Creates the DB-backed session row. Does not touch cookies. */
export async function createDbSession(userId: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  return db.session.create({ data: { userId, expiresAt } });
}

/**
 * Looks up a session by id and returns it (with its user) only if it's
 * still valid — not revoked, not expired, and the user is still ACTIVE.
 * Returns null otherwise so callers have one thing to check.
 */
export async function getActiveDbSession(sessionId: string) {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;
  return session;
}

/** Revokes a session server-side (logout). Idempotent. */
export async function revokeDbSession(sessionId: string): Promise<void> {
  await db.session
    .update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
    .catch(() => {
      // Already gone / already revoked — logout should never throw.
    });
}

/** Records a successful login as an audit event (BR-08). */
export async function recordLoginAudit(user: {
  id: string;
  organizationId: string;
}): Promise<void> {
  await recordAudit({
    organizationId: user.organizationId,
    entityType: "User",
    entityId: user.id,
    action: "LOGIN",
    actorId: user.id,
    sourceChannel: "WEB",
  });
}
