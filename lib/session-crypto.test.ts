import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptSessionCookie,
  encryptSessionCookie,
} from "@/lib/session-crypto";

beforeAll(() => {
  process.env.SESSION_SECRET ??= "test-secret-do-not-use-in-real-environments";
});

describe("session cookie encryption", () => {
  it("round-trips a payload through encrypt/decrypt", async () => {
    const token = await encryptSessionCookie({ sessionId: "session-123" });
    const decoded = await decryptSessionCookie(token);
    expect(decoded).toEqual({ sessionId: "session-123" });
  });

  it("returns null for a missing token", async () => {
    await expect(decryptSessionCookie(undefined)).resolves.toBeNull();
  });

  it("returns null for a malformed token", async () => {
    await expect(decryptSessionCookie("not-a-real-jwt")).resolves.toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const token = await encryptSessionCookie({ sessionId: "session-123" });
    const originalSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-completely-different-secret-value";
    try {
      await expect(decryptSessionCookie(token)).resolves.toBeNull();
    } finally {
      process.env.SESSION_SECRET = originalSecret;
    }
  });
});
