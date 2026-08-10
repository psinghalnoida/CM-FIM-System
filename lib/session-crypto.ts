import "server-only";
import { SignJWT, jwtVerify } from "jose";

// The browser cookie holds only an encrypted { sessionId }, never session
// contents — the DB row (lib/session-service.ts) is the source of truth,
// so a session can be revoked server-side without waiting for the cookie
// to expire. Per docs/AUTH.md / this Next.js version's own recommended
// pattern (node_modules/next/dist/docs/.../authentication.md).

export const SESSION_COOKIE_NAME = "cm_fim_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Copy .env.example to .env.");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionCookiePayload {
  sessionId: string;
}

export async function encryptSessionCookie(
  payload: SessionCookiePayload,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function decryptSessionCookie(
  token: string | undefined,
): Promise<SessionCookiePayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    if (typeof payload.sessionId !== "string") return null;
    return { sessionId: payload.sessionId };
  } catch {
    // Expired, malformed, or signed with a different secret — all treated
    // as "no session", never surfaced as a distinct error to the caller.
    return null;
  }
}
