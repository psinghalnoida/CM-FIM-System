// Only requireRole() is unit-tested directly — getSession()/verifySession()
// are thin compositions of next/headers cookies() (needs a real Next
// request context to test meaningfully) over decryptSessionCookie() and
// getActiveDbSession(), both already covered by
// session-crypto.test.ts/auth.integration.test.ts.
//
// forbidden()/unauthorized() gate on an internal Next env var
// (__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS) that Next itself sets at runtime
// when experimental.authInterrupts is on; outside Next's own runtime nothing
// sets it, so it's set by hand here to reach the real throwing code path.
// If a Next upgrade changes this mechanism, this is the test that will
// need updating.
import { beforeAll, describe, expect, it } from "vitest";
import { requireRole } from "@/lib/dal";

beforeAll(() => {
  process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = "true";
});

describe("requireRole", () => {
  it("does not throw when the session's role is in the allow-list", () => {
    const session = { user: { role: "CLAIMS_MANAGER" as const } };
    expect(() =>
      requireRole(session, "CLAIMS_MANAGER", "ORG_ADMIN"),
    ).not.toThrow();
  });

  it("throws when the session's role is not in the allow-list", () => {
    const session = { user: { role: "SURVEYOR" as const } };
    expect(() => requireRole(session, "CLAIMS_MANAGER", "ORG_ADMIN")).toThrow();
  });
});
