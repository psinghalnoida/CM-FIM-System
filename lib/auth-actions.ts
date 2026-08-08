import "server-only";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  createDbSession,
  revokeDbSession,
  verifyCredentials,
  recordLoginAudit,
} from "@/lib/session-service";
import {
  encryptSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/session-crypto";
import { getSession } from "@/lib/dal";

// Split from app/actions/auth.ts ("use server") on purpose: these functions
// are plain, directly unit-testable (no Next.js request context required
// except the final cookie write), which app/actions/auth.ts's thin
// Server Actions call into. See lib/auth-actions.test.ts.

export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
});

export type LoginState =
  | { errors: { email?: string[]; password?: string[]; form?: string[] } }
  | undefined;

/**
 * Validates credentials and creates a DB session, but does NOT touch
 * cookies — the caller (a Server Action, which has request context) is
 * responsible for setting the returned cookie value.
 */
export async function performLogin(
  email: string,
  password: string,
): Promise<{ ok: true; cookieValue: string } | { ok: false; error: string }> {
  const user = await verifyCredentials(email, password);
  if (!user) {
    return { ok: false, error: "Invalid email or password." };
  }

  const dbSession = await createDbSession(user.id);
  const cookieValue = await encryptSessionCookie({ sessionId: dbSession.id });
  await recordLoginAudit(user);

  return { ok: true, cookieValue };
}

/** Sets the session cookie — has request context, so lives outside performLogin(). */
export async function setSessionCookie(cookieValue: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Revokes the current session (DB + cookie), if there is one. */
export async function performLogout(): Promise<void> {
  const session = await getSession();
  if (session) {
    await revokeDbSession(session.id);
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
