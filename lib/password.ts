import bcrypt from "bcryptjs";

// bcryptjs (pure JS, no native build step) rather than argon2/bcrypt native
// bindings — see docs/AUTH.md for why.
//
// No "server-only" guard here (unlike the rest of lib/*.ts in this
// milestone): this module touches no secrets or DB, and prisma/seed.ts
// (run via tsx, outside Next's build) needs to import it directly.
const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
