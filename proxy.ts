// Optimistic route protection. Named `proxy.ts`, not `middleware.ts` — this
// Next.js version renamed Middleware to Proxy (same functionality); see
// node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md.
//
// This only decrypts the cookie (no DB call — Proxy runs on every request,
// including prefetches, so it must stay fast) to redirect obviously-wrong
// requests early. It is NOT the real authorization check: verifySession()
// in lib/dal.ts (which does hit the DB, confirming the session isn't
// revoked/expired and the user is still ACTIVE) is what every protected
// Server Component/Action/Route actually relies on. See docs/AUTH.md.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  decryptSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/session-crypto";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/cities",
  "/depots",
  "/vehicles",
  "/drivers",
  "/incidents",
  "/claims",
  "/tat",
  "/dashboards",
  "/documents",
  "/escalation-rules",
  "/admin",
  "/fleet",
  "/reports",
  "/my-work",
];
const AUTH_ROUTES = ["/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (!isProtected && !isAuthRoute) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const payload = await decryptSessionCookie(token);

  if (isProtected && !payload) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthRoute && payload) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/cities/:path*",
    "/depots/:path*",
    "/vehicles/:path*",
    "/drivers/:path*",
    "/incidents/:path*",
    "/claims/:path*",
    "/tat/:path*",
    "/dashboards/:path*",
    "/documents/:path*",
    "/escalation-rules/:path*",
    "/admin/:path*",
    "/fleet/:path*",
    "/reports/:path*",
    "/my-work/:path*",
    "/login",
  ],
};
